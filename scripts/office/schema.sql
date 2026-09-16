-- Additive, idempotent Office Pi schema. Applied explicitly, never at request time.
CREATE TABLE IF NOT EXISTS office_users (
 id uuid PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL,
 can_print boolean NOT NULL DEFAULT false, can_edit boolean NOT NULL DEFAULT false,
 is_admin boolean NOT NULL DEFAULT false, disabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS office_sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES office_users(id),
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS office_login_attempts (
 key text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS office_stations (
 id text PRIMARY KEY, token_hash text UNIQUE, revoked_at timestamptz,
 dispatch_enabled boolean NOT NULL DEFAULT false, paired_at timestamptz,
 last_seen timestamptz, agent_version text, advertised_printers jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS office_printers (
 station_id text NOT NULL REFERENCES office_stations(id), id text NOT NULL,
 name text NOT NULL, serial text NOT NULL, dpi integer NOT NULL,
 max_width_dots integer NOT NULL, enabled boolean NOT NULL DEFAULT true,
 PRIMARY KEY(station_id,id)
);
CREATE TABLE IF NOT EXISTS office_printer_access (
 user_id uuid NOT NULL REFERENCES office_users(id), station_id text NOT NULL,
 printer_id text NOT NULL, PRIMARY KEY(user_id,station_id,printer_id),
 FOREIGN KEY(station_id,printer_id) REFERENCES office_printers(station_id,id)
);
CREATE TABLE IF NOT EXISTS office_requests (
 id uuid PRIMARY KEY, requester uuid NOT NULL REFERENCES office_users(id),
 idempotency_key uuid NOT NULL, fingerprint text NOT NULL,
 run_id text NOT NULL REFERENCES runs(id), template_id text NOT NULL REFERENCES templates(id),
 station_id text NOT NULL, printer_id text NOT NULL,
 range_from integer NOT NULL, range_to integer NOT NULL,
 reprint_of uuid REFERENCES office_requests(id), reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requester,idempotency_key), FOREIGN KEY(station_id,printer_id) REFERENCES office_printers(station_id,id)
);
CREATE TABLE IF NOT EXISTS office_jobs (
 id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES office_requests(id),
 station_id text NOT NULL, printer_id text NOT NULL,
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 range_from integer NOT NULL, range_to integer NOT NULL,
 label_count integer NOT NULL CHECK(label_count BETWEEN 1 AND 25),
 payload_base64 text NOT NULL, sha256 text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','claimed','submitted','sent_to_printer','rejected','needs_review','cancelled','resolved')),
 review_required boolean NOT NULL DEFAULT false, reason text, cups_job_id integer,
 claimed_at timestamptz, submitted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(station_id,printer_id) REFERENCES office_printers(station_id,id),
 CHECK(octet_length(decode(payload_base64,'base64')) BETWEEN 1 AND 2097152)
);
CREATE INDEX IF NOT EXISTS office_jobs_dispatch_idx ON office_jobs(station_id,sequence);
CREATE TABLE IF NOT EXISTS office_events (
 event_id uuid PRIMARY KEY, station_id text NOT NULL, job_id uuid NOT NULL REFERENCES office_jobs(id),
 body jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS office_reviews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job_id uuid NOT NULL REFERENCES office_jobs(id),
 operator_id uuid REFERENCES office_users(id), reason text NOT NULL, detail jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- Every dispatch/event/cancel/review serializes on the station row.
CREATE OR REPLACE FUNCTION office_expire_jobs(sid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE office_jobs SET review_required=true, reason='station_outcome_timeout', updated_at=now()
 WHERE station_id=sid AND review_required=false AND
 ((state='claimed' AND claimed_at < now()-interval '5 minutes') OR
  (state='submitted' AND submitted_at < now()-interval '30 minutes'));
END $$;

CREATE OR REPLACE FUNCTION office_poll(sid text, version text, advertised jsonb, accept_job boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j office_jobs; enabled boolean;
BEGIN
 SELECT dispatch_enabled INTO enabled FROM office_stations WHERE id=sid FOR UPDATE;
 UPDATE office_stations SET last_seen=now(), agent_version=version, advertised_printers=advertised WHERE id=sid;
 PERFORM office_expire_jobs(sid);
 IF EXISTS(SELECT 1 FROM office_control_status WHERE station_id=sid) AND (
 EXISTS(SELECT 1 FROM office_controls WHERE station_id=sid AND result IS NULL) OR
 NOT EXISTS(SELECT 1 FROM office_control_status o WHERE o.station_id=sid AND o.paused=false AND o.received_at>now()-interval '30 seconds' AND o.received_at>coalesce((SELECT max(resolved_at) FROM office_controls WHERE station_id=sid),'epoch'::timestamptz))
 ) THEN RETURN jsonb_build_object('protocol',1,'job',NULL); END IF;
 IF NOT accept_job OR NOT enabled THEN RETURN jsonb_build_object('protocol',1,'job',NULL); END IF;
 IF EXISTS(SELECT 1 FROM office_jobs WHERE station_id=sid AND review_required) THEN
  RETURN jsonb_build_object('protocol',1,'job',NULL);
 END IF;
 SELECT * INTO j FROM office_jobs WHERE station_id=sid AND state IN ('claimed','submitted','needs_review') ORDER BY sequence LIMIT 1;
 IF FOUND AND j.state <> 'claimed' THEN RETURN jsonb_build_object('protocol',1,'job',NULL); END IF;
 IF j.id IS NULL THEN
  SELECT * INTO j FROM office_jobs WHERE station_id=sid AND state='queued' ORDER BY sequence LIMIT 1 FOR UPDATE;
 END IF;
 IF j.id IS NULL OR NOT EXISTS (
  SELECT 1 FROM office_printers p, jsonb_array_elements(advertised) a
  WHERE p.station_id=sid AND p.id=j.printer_id AND p.enabled
  AND a->>'id'=p.id AND a->>'serial'=p.serial AND a->>'available'='true'
  AND (a->>'dpi')::integer=p.dpi AND (a->>'max_width_dots')::integer>=p.max_width_dots
  AND (a->'content_types') ? 'application/vnd.zebra-zpl'
 ) THEN RETURN jsonb_build_object('protocol',1,'job',NULL); END IF;
 UPDATE office_jobs SET state='claimed', claimed_at=coalesce(claimed_at,now()),updated_at=now() WHERE id=j.id;
 RETURN jsonb_build_object('protocol',1,'job',jsonb_build_object('id',j.id,'printer_id',j.printer_id,
 'content_type','application/vnd.zebra-zpl','label_count',j.label_count,'sha256',j.sha256,'payload_base64',j.payload_base64));
END $$;

CREATE OR REPLACE FUNCTION office_event(sid text, event jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j office_jobs; existing office_events; next_state text; conflict boolean := false; req office_requests;
BEGIN
 PERFORM 1 FROM office_stations WHERE id=sid FOR UPDATE;
 UPDATE office_stations SET last_seen=now() WHERE id=sid;
 PERFORM office_expire_jobs(sid);
 SELECT * INTO j FROM office_jobs WHERE id=(event->>'job_id')::uuid AND station_id=sid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job not owned by station'; END IF;
 SELECT * INTO existing FROM office_events WHERE event_id=(event->>'event_id')::uuid;
 IF FOUND THEN
  IF existing.station_id<>sid OR existing.job_id<>j.id OR existing.body<>event THEN
   UPDATE office_jobs SET review_required=true,reason='conflicting_event_id' WHERE id=j.id;
   INSERT INTO office_reviews(job_id,reason,detail) VALUES(j.id,'conflicting_event_id',event);
  END IF;
  RETURN jsonb_build_object('ok',true,'event_id',event->>'event_id');
 END IF;
 INSERT INTO office_events(event_id,station_id,job_id,body) VALUES((event->>'event_id')::uuid,sid,j.id,event);
 next_state := event->>'state';
 IF j.cups_job_id IS NOT NULL AND event->>'cups_job_id' IS NOT NULL AND j.cups_job_id<>(event->>'cups_job_id')::integer THEN conflict:=true; END IF;
 IF j.state IN ('queued','cancelled','resolved','rejected') THEN conflict:=true; END IF;
 IF j.state='sent_to_printer' AND next_state NOT IN ('submitted','sent_to_printer') THEN conflict:=true; END IF;
 IF j.state='submitted' AND next_state='rejected' THEN conflict:=true; END IF;
 IF conflict THEN
  UPDATE office_jobs SET review_required=true,reason='conflicting_event',updated_at=now() WHERE id=j.id;
  INSERT INTO office_reviews(job_id,reason,detail) VALUES(j.id,'conflicting_event',event);
 ELSE
  UPDATE office_jobs SET
   state=CASE WHEN j.state='sent_to_printer' THEN j.state WHEN j.state='needs_review' THEN j.state ELSE next_state END,
   review_required=review_required OR next_state IN ('needs_review','rejected'),
   reason=CASE WHEN review_required THEN reason ELSE event->>'reason' END,
   cups_job_id=coalesce(cups_job_id,(event->>'cups_job_id')::integer),
   submitted_at=CASE WHEN next_state='submitted' THEN coalesce(submitted_at,now()) ELSE submitted_at END,updated_at=now()
   WHERE id=j.id;
  IF next_state='sent_to_printer' AND j.state NOT IN ('sent_to_printer','needs_review') THEN
   SELECT * INTO req FROM office_requests WHERE id=j.request_id;
   INSERT INTO run_print_events(id,run_id,event_type,output,range_from,range_to,label_count,printer_name,message,created_at)
   VALUES('office-'||j.id,req.run_id,'sent','office-pi',j.range_from,j.range_to,j.label_count,j.printer_id,
    'Sent to printer via Office Pi (CUPS delivery; physical printing unconfirmed)',now()::text) ON CONFLICT(id) DO NOTHING;
  END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'event_id',event->>'event_id');
END $$;

CREATE OR REPLACE FUNCTION office_enqueue(uid uuid, rid uuid, ikey uuid, fp text, runid text, templateid text,
 sid text, pid text, lo integer, hi integer, original uuid, why text, batches jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE previous office_requests; batch jsonb;
BEGIN
 PERFORM 1 FROM office_stations WHERE id=sid FOR UPDATE;
 SELECT * INTO previous FROM office_requests WHERE requester=uid AND idempotency_key=ikey;
 IF FOUND THEN
  IF previous.fingerprint<>fp THEN RAISE EXCEPTION 'Idempotency key already used for another request'; END IF;
  RETURN previous.id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM office_stations WHERE id=sid AND dispatch_enabled AND paired_at IS NOT NULL AND revoked_at IS NULL) THEN RAISE EXCEPTION 'Station pairing not activated'; END IF;
 IF NOT EXISTS(SELECT 1 FROM office_users u JOIN office_printer_access a ON a.user_id=u.id
 JOIN office_printers p ON p.station_id=a.station_id AND p.id=a.printer_id
 WHERE u.id=uid AND u.can_print AND NOT u.disabled AND p.enabled AND a.station_id=sid AND a.printer_id=pid) THEN RAISE EXCEPTION 'Print access denied'; END IF;
 PERFORM office_expire_jobs(sid);
 IF EXISTS(SELECT 1 FROM office_jobs WHERE station_id=sid AND review_required) THEN RAISE EXCEPTION 'Check printer before retrying'; END IF;
 IF original IS NULL AND EXISTS(SELECT 1 FROM office_requests r JOIN office_jobs j ON j.request_id=r.id
 WHERE r.run_id=runid AND j.range_from<=hi AND j.range_to>=lo AND j.state <> 'cancelled') THEN
 RAISE EXCEPTION 'This range has already been queued. Use an intentional reprint with a reason.'; END IF;
 IF original IS NOT NULL THEN
  IF why IS NULL OR length(trim(why))<3 OR NOT EXISTS(SELECT 1 FROM office_requests WHERE id=original AND run_id=runid AND range_from<=lo AND range_to>=hi) THEN RAISE EXCEPTION 'Invalid reprint reference or reason'; END IF;
  IF EXISTS(SELECT 1 FROM office_jobs WHERE request_id=original AND (state IN ('queued','claimed','submitted','needs_review') OR review_required)) THEN RAISE EXCEPTION 'Resolve pending original jobs before reprinting'; END IF;
 END IF;
 INSERT INTO office_requests(id,requester,idempotency_key,fingerprint,run_id,template_id,station_id,printer_id,range_from,range_to,reprint_of,reason)
 VALUES(rid,uid,ikey,fp,runid,templateid,sid,pid,lo,hi,original,why);
 FOR batch IN SELECT * FROM jsonb_array_elements(batches) LOOP
  INSERT INTO office_jobs(id,request_id,station_id,printer_id,range_from,range_to,label_count,payload_base64,sha256)
  VALUES((batch->>'id')::uuid,rid,sid,pid,(batch->>'from')::integer,(batch->>'to')::integer,
   (batch->>'count')::integer,batch->>'payload',batch->>'sha256');
 END LOOP;
 RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION office_cancel(uid uuid, rid uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE sid text; affected integer; pending integer;
BEGIN
 SELECT station_id INTO sid FROM office_requests WHERE id=rid;
 PERFORM 1 FROM office_stations WHERE id=sid FOR UPDATE;
 WITH cancelled AS (UPDATE office_jobs SET state='cancelled',updated_at=now(),reason='operator_cancelled' WHERE request_id=rid AND state='queued' RETURNING id)
 INSERT INTO office_reviews(job_id,operator_id,reason) SELECT id,uid,'cancel_unclaimed' FROM cancelled;
 GET DIAGNOSTICS affected=ROW_COUNT;
 SELECT count(*) INTO pending FROM office_jobs WHERE request_id=rid AND (state IN ('claimed','submitted','needs_review') OR review_required);
 RETURN jsonb_build_object('cancelled',affected,'requires_review',pending);
END $$;

CREATE OR REPLACE FUNCTION office_resolve(uid uuid, jid uuid, why text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE sid text;
BEGIN
 SELECT station_id INTO sid FROM office_jobs WHERE id=jid;
 PERFORM 1 FROM office_stations WHERE id=sid FOR UPDATE;
 UPDATE office_jobs SET state='resolved',review_required=false,reason='operator_resolved',updated_at=now()
 WHERE id=jid AND (state IN ('claimed','submitted','needs_review','rejected') OR review_required);
 IF NOT FOUND THEN RAISE EXCEPTION 'Job does not require resolution'; END IF;
 INSERT INTO office_reviews(job_id,operator_id,reason) VALUES(jid,uid,why);
END $$;
