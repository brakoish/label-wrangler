ALTER TABLE office_users ADD COLUMN IF NOT EXISTS can_control boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS office_control_status (
 station_id text NOT NULL, printer_id text NOT NULL, paused boolean, received_at timestamptz NOT NULL,
 PRIMARY KEY(station_id,printer_id), FOREIGN KEY(station_id,printer_id) REFERENCES office_printers(station_id,id)
);
CREATE TABLE IF NOT EXISTS office_controls (
 id uuid PRIMARY KEY, station_id text NOT NULL, printer_id text NOT NULL, requester uuid NOT NULL REFERENCES office_users(id),
 idempotency_key uuid NOT NULL, action text NOT NULL CHECK(action IN ('pause','resume')),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '60 seconds',
 claimed_at timestamptz, resolved_at timestamptz, result jsonb,
 UNIQUE(requester,idempotency_key), FOREIGN KEY(station_id,printer_id) REFERENCES office_printers(station_id,id)
);
CREATE OR REPLACE FUNCTION office_control_create(uid uuid,sid text,pid text,act text,key uuid,cid uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE c office_controls;
BEGIN
 PERFORM 1 FROM office_stations WHERE id=sid AND revoked_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Station unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM office_users u JOIN office_printer_access a ON a.user_id=u.id JOIN office_printers p ON p.station_id=a.station_id AND p.id=a.printer_id WHERE u.id=uid AND NOT u.disabled AND u.can_control AND a.station_id=sid AND a.printer_id=pid AND p.enabled) THEN RAISE EXCEPTION 'Control permission denied'; END IF;
 SELECT * INTO c FROM office_controls WHERE requester=uid AND idempotency_key=key;
 IF FOUND THEN
  IF c.station_id<>sid OR c.printer_id<>pid OR c.action<>act THEN RAISE EXCEPTION 'Idempotency conflict'; END IF;
  RETURN c.id;
 END IF;
 UPDATE office_controls SET resolved_at=now(),result=jsonb_build_object('state','expired','reason','expired_before_send') WHERE station_id=sid AND printer_id=pid AND result IS NULL AND claimed_at IS NULL AND expires_at<=now();
 IF EXISTS(SELECT 1 FROM office_controls WHERE station_id=sid AND printer_id=pid AND result IS NULL) THEN RAISE EXCEPTION 'A printer control is still pending'; END IF;
 IF NOT EXISTS(SELECT 1 FROM office_control_status WHERE station_id=sid AND printer_id=pid AND received_at>now()-interval '30 seconds') THEN RAISE EXCEPTION 'Control worker offline'; END IF;
 INSERT INTO office_controls(id,station_id,printer_id,requester,idempotency_key,action) VALUES(cid,sid,pid,uid,key,act);
 RETURN cid;
END $$;
CREATE OR REPLACE FUNCTION office_controls_poll(sid text,advertised jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE p jsonb; c office_controls;
BEGIN
 PERFORM 1 FROM office_stations WHERE id=sid FOR UPDATE;
 FOR p IN SELECT * FROM jsonb_array_elements(advertised) LOOP
  IF NOT EXISTS(SELECT 1 FROM office_printers WHERE station_id=sid AND id=p->>'id' AND serial=p->>'serial' AND enabled) THEN RAISE EXCEPTION 'Printer binding mismatch'; END IF;
  INSERT INTO office_control_status(station_id,printer_id,paused,received_at) VALUES(sid,p->>'id',(p->>'paused')::boolean,now()) ON CONFLICT(station_id,printer_id) DO UPDATE SET paused=excluded.paused,received_at=excluded.received_at;
 END LOOP;
 UPDATE office_controls SET resolved_at=now(),result=jsonb_build_object('state','expired','reason','expired_before_send') WHERE station_id=sid AND result IS NULL AND claimed_at IS NULL AND expires_at<=now();
 SELECT * INTO c FROM office_controls WHERE station_id=sid AND result IS NULL ORDER BY created_at LIMIT 1;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(advertised) a WHERE a->>'id'=c.printer_id AND a->'actions' ? c.action) THEN RETURN jsonb_build_object('protocol',1,'control',NULL); END IF;
 UPDATE office_controls SET claimed_at=coalesce(claimed_at,now()) WHERE id=c.id;
 RETURN jsonb_build_object('protocol',1,'control',jsonb_build_object('id',c.id,'printer_id',c.printer_id,'action',c.action,'expires_at_unix',extract(epoch FROM c.expires_at)));
END $$;
CREATE OR REPLACE FUNCTION office_control_event(sid text,event jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c office_controls;
BEGIN
 PERFORM 1 FROM office_stations WHERE id=sid FOR UPDATE;
 SELECT * INTO c FROM office_controls WHERE id=(event->>'control_id')::uuid AND station_id=sid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Control ownership mismatch'; END IF;
 IF c.result IS NOT NULL THEN
  IF c.result<>event THEN RAISE EXCEPTION 'Conflicting control result'; END IF;
 ELSE
  UPDATE office_controls SET result=event,resolved_at=now() WHERE id=c.id;
 END IF;
 RETURN jsonb_build_object('ok',true,'control_id',event->>'control_id');
END $$;
