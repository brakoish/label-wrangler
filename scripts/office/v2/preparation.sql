-- Inactive v2 preparation only. No reference to or mutation of v1 dispatch tables.
CREATE TABLE IF NOT EXISTS office_v2_preparations (
 id uuid PRIMARY KEY,
 requester uuid NOT NULL,
 idempotency_key uuid NOT NULL,
 fingerprint text NOT NULL,
 snapshot bytea NOT NULL CHECK(octet_length(snapshot) BETWEEN 1 AND 33554432),
 snapshot_sha256 text NOT NULL,
 generator_revision text NOT NULL,
 station_id text NOT NULL,
 printer_id text NOT NULL,
 range_from integer NOT NULL CHECK(range_from>0),
 range_to integer NOT NULL,
 labels_across integer NOT NULL CHECK(labels_across BETWEEN 1 AND 25),
 state text NOT NULL DEFAULT 'preparing' CHECK(state IN ('preparing','prepared','failed','canceled')),
 fence bigint NOT NULL DEFAULT 0,
 lease_until timestamptz,
 next_ordinal integer NOT NULL DEFAULT 0,
 next_feed integer NOT NULL DEFAULT 0,
 total_bytes bigint NOT NULL DEFAULT 0,
 payload_limit bigint NOT NULL DEFAULT 268435456 CHECK(payload_limit BETWEEN 1 AND 268435456),
 manifest bytea,
 manifest_sha256 text,
 failure_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requester,idempotency_key),
 CHECK(range_to>=range_from AND range_to-range_from+1<=5000)
);
CREATE TABLE IF NOT EXISTS office_v2_prepared_chunks (
 run_id uuid NOT NULL REFERENCES office_v2_preparations(id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 4999),
 chunk_id uuid NOT NULL UNIQUE,
 descriptor jsonb NOT NULL,
 payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 2097152),
 sha256 text NOT NULL,
 PRIMARY KEY(run_id,ordinal)
);

CREATE OR REPLACE FUNCTION office_v2_prepare_submit(p_id uuid,p_requester uuid,p_key uuid,p_snapshot bytea,p_revision text,
 p_station text,p_printer text,p_from integer,p_to integer,p_across integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE existing_task office_v2_preparations; fp text;
BEGIN
 fp:=encode(sha256(p_snapshot || convert_to(jsonb_build_array(p_revision,p_station,p_printer,p_from,p_to,p_across)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_requester::text||p_key::text,0));
 SELECT * INTO existing_task FROM office_v2_preparations WHERE requester=p_requester AND idempotency_key=p_key;
 IF FOUND THEN
  IF existing_task.fingerprint<>fp THEN RAISE EXCEPTION 'preparation_idempotency_conflict'; END IF;
  RETURN existing_task.id;
 END IF;
 INSERT INTO office_v2_preparations(id,requester,idempotency_key,fingerprint,snapshot,snapshot_sha256,generator_revision,station_id,printer_id,range_from,range_to,labels_across)
 VALUES(p_id,p_requester,p_key,fp,p_snapshot,encode(sha256(p_snapshot),'hex'),p_revision,p_station,p_printer,p_from,p_to,p_across);
 RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION office_v2_prepare_claim(p_revision text) RETURNS SETOF office_v2_preparations LANGUAGE plpgsql AS $$
DECLARE task_id uuid;
BEGIN
 -- One task at a time even with overlapping process restarts.
 PERFORM pg_advisory_xact_lock(720260917);
 IF EXISTS(SELECT 1 FROM office_v2_preparations WHERE state='preparing' AND lease_until>clock_timestamp()) THEN RETURN; END IF;
 SELECT id INTO task_id FROM office_v2_preparations WHERE state='preparing' AND generator_revision=p_revision
 AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF task_id IS NULL THEN RETURN; END IF;
 RETURN QUERY UPDATE office_v2_preparations SET fence=fence+1,lease_until=clock_timestamp()+interval '60 seconds' WHERE id=task_id RETURNING *;
END $$;

CREATE OR REPLACE FUNCTION office_v2_prepare_renew(p_id uuid,p_fence bigint) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 UPDATE office_v2_preparations SET lease_until=clock_timestamp()+interval '60 seconds'
 WHERE id=p_id AND fence=p_fence AND state='preparing' AND lease_until>clock_timestamp();
 RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION office_v2_prepare_append(p_id uuid,p_fence bigint,p_descriptor jsonb,p_payload bytea) RETURNS void LANGUAGE plpgsql AS $$
DECLARE task office_v2_preparations; old office_v2_prepared_chunks; f jsonb; n integer; off integer:=0; labels integer:=0; lane jsonb; physical bigint; lane_index integer; feed_index integer; expected bigint;
BEGIN
 SELECT * INTO task FROM office_v2_preparations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR task.state<>'preparing' OR task.fence<>p_fence OR task.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'stale_preparation_owner'; END IF;
 IF jsonb_typeof(p_descriptor) IS DISTINCT FROM 'object' OR
 NOT (p_descriptor ?& ARRAY['chunk_id','ordinal','label_count','feed_count','byte_count','sha256','feeds']) OR
 (SELECT count(*) FROM jsonb_object_keys(p_descriptor))<>7 OR
 EXISTS(SELECT 1 FROM jsonb_each(p_descriptor) WHERE value='null'::jsonb) THEN RAISE EXCEPTION 'chunk_fields'; END IF;
 n:=(p_descriptor->>'ordinal')::integer;
 SELECT * INTO old FROM office_v2_prepared_chunks WHERE run_id=p_id AND ordinal=n;
 IF FOUND THEN
  IF old.descriptor<>p_descriptor OR old.payload<>p_payload THEN RAISE EXCEPTION 'immutable_chunk_conflict'; END IF;
  RETURN; -- committed append with lost acknowledgement
 END IF;
 IF n<>task.next_ordinal OR n>=5000 THEN RAISE EXCEPTION 'checkpoint_conflict'; END IF;
 IF octet_length(p_payload) NOT BETWEEN 1 AND 2097152 OR (p_descriptor->>'byte_count')::integer<>octet_length(p_payload)
 OR p_descriptor->>'sha256'<>encode(sha256(p_payload),'hex') THEN RAISE EXCEPTION 'chunk_integrity'; END IF;
 IF task.total_bytes+octet_length(p_payload)>task.payload_limit THEN RAISE EXCEPTION 'payload_quota'; END IF;
 IF jsonb_typeof(p_descriptor->'feeds')<>'array' OR jsonb_array_length(p_descriptor->'feeds')<1 THEN RAISE EXCEPTION 'feed_mapping'; END IF;
 feed_index:=task.next_feed;
 FOR f IN SELECT value FROM jsonb_array_elements(p_descriptor->'feeds') LOOP
  IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR NOT(f ?& ARRAY['feed_ordinal','byte_offset','byte_count','lanes']) OR
  (SELECT count(*) FROM jsonb_object_keys(f))<>4 OR EXISTS(SELECT 1 FROM jsonb_each(f) WHERE value='null'::jsonb) THEN RAISE EXCEPTION 'feed_fields'; END IF;
  IF (f->>'feed_ordinal')::integer<>feed_index OR (f->>'byte_offset')::integer<>off OR (f->>'byte_count')::integer<1 THEN RAISE EXCEPTION 'feed_mapping'; END IF;
  IF jsonb_array_length(f->'lanes')<>task.labels_across THEN RAISE EXCEPTION 'lane_mapping'; END IF;
  physical:=((task.range_from-1)/task.labels_across)*task.labels_across+feed_index*task.labels_across+1;
  lane_index:=0;
  FOR lane IN SELECT value FROM jsonb_array_elements(f->'lanes') LOOP
   expected:=physical+lane_index;
   IF expected BETWEEN task.range_from AND task.range_to THEN
    IF lane<>to_jsonb(expected) THEN RAISE EXCEPTION 'lane_mapping'; END IF;
    labels:=labels+1;
   ELSIF lane<>'null'::jsonb THEN RAISE EXCEPTION 'lane_mapping'; END IF;
   lane_index:=lane_index+1;
  END LOOP;
  feed_index:=feed_index+1; off:=off+(f->>'byte_count')::integer;
 END LOOP;
 IF off<>octet_length(p_payload) OR labels<>(p_descriptor->>'label_count')::integer
 OR feed_index-task.next_feed<>(p_descriptor->>'feed_count')::integer OR feed_index>5000 THEN RAISE EXCEPTION 'feed_mapping'; END IF;
 INSERT INTO office_v2_prepared_chunks VALUES(p_id,n,(p_descriptor->>'chunk_id')::uuid,p_descriptor,p_payload,p_descriptor->>'sha256');
 UPDATE office_v2_preparations SET next_ordinal=n+1,next_feed=feed_index,total_bytes=total_bytes+octet_length(p_payload),lease_until=clock_timestamp()+interval '60 seconds' WHERE id=p_id;
END $$;

CREATE OR REPLACE FUNCTION office_v2_prepare_seal(p_id uuid,p_fence bigint,p_manifest bytea) RETURNS void LANGUAGE plpgsql AS $$
DECLARE task office_v2_preparations; m jsonb; descriptors jsonb; expected_feeds integer;
BEGIN
 SELECT * INTO task FROM office_v2_preparations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR task.fence<>p_fence THEN RAISE EXCEPTION 'stale_preparation_owner'; END IF;
 IF task.state='prepared' AND task.manifest=p_manifest THEN RETURN; END IF;
 IF task.state<>'preparing' OR task.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'stale_preparation_owner'; END IF;
 IF octet_length(p_manifest) NOT BETWEEN 1 AND 4194304 THEN RAISE EXCEPTION 'manifest_quota'; END IF;
 m:=convert_from(p_manifest,'UTF8')::jsonb;
 SELECT jsonb_agg(descriptor ORDER BY ordinal) INTO descriptors FROM office_v2_prepared_chunks WHERE run_id=p_id;
 expected_feeds:=((task.range_to-1)/task.labels_across)-((task.range_from-1)/task.labels_across)+1;
 IF m IS DISTINCT FROM jsonb_build_object('protocol',2,'print_run_id',task.id,'snapshot_sha256',task.snapshot_sha256,
 'station_id',task.station_id,'printer_id',task.printer_id,'range_from',task.range_from,'range_to',task.range_to,
 'label_count',task.range_to-task.range_from+1,'labels_across',task.labels_across,'feed_count',task.next_feed,'total_bytes',task.total_bytes,'chunks',descriptors)
 OR task.next_feed<>expected_feeds THEN RAISE EXCEPTION 'manifest_integrity'; END IF;
 UPDATE office_v2_preparations SET state='prepared',manifest=p_manifest,manifest_sha256=encode(sha256(p_manifest),'hex'),lease_until=NULL WHERE id=p_id;
END $$;
