CREATE TYPE user_role AS ENUM ('ENCODER', 'VERIFIER', 'ADMIN');
CREATE TYPE submission_state AS ENUM (
  'DRAFT', 'UPLOADING', 'PENDING_VERIFICATION', 'IN_REVIEW', 'NEEDS_CORRECTION',
  'VERIFIED', 'REJECTED', 'FINALIZED', 'EXPIRED'
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role user_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  access_hash text NOT NULL UNIQUE,
  refresh_hash text NOT NULL UNIQUE,
  mode text NOT NULL CHECK (mode IN ('native', 'browser')),
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE TABLE document_templates (
  id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (id, version)
);
CREATE TABLE template_pages (
  template_id text NOT NULL,
  template_version integer NOT NULL,
  page_number integer NOT NULL CHECK (page_number > 0),
  display_order integer NOT NULL CHECK (display_order > 0),
  capture boolean NOT NULL,
  required boolean NOT NULL CHECK (NOT required OR capture),
  label text NOT NULL,
  PRIMARY KEY (template_id, template_version, page_number),
  UNIQUE (template_id, template_version, display_order),
  FOREIGN KEY (template_id, template_version) REFERENCES document_templates
);
CREATE TABLE template_fields (
  template_id text NOT NULL,
  template_version integer NOT NULL,
  field_key text NOT NULL,
  page_number integer NOT NULL,
  label text NOT NULL,
  data_type text NOT NULL,
  display_order integer NOT NULL CHECK (display_order > 0),
  rules jsonb NOT NULL,
  PRIMARY KEY (template_id, template_version, field_key),
  UNIQUE (template_id, template_version, field_key, page_number),
  UNIQUE (template_id, template_version, display_order),
  FOREIGN KEY (template_id, template_version, page_number) REFERENCES template_pages
);
CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_submission_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id),
  template_id text NOT NULL,
  template_version integer NOT NULL,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status submission_state NOT NULL DEFAULT 'DRAFT',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  reviewer_id uuid REFERENCES users(id),
  UNIQUE (owner_id, client_submission_id),
  UNIQUE (id, template_id, template_version),
  FOREIGN KEY (template_id, template_version) REFERENCES document_templates,
  CHECK ((status IN ('DRAFT','UPLOADING','EXPIRED')) = (completed_at IS NULL)),
  CHECK ((status IN ('IN_REVIEW','NEEDS_CORRECTION','REJECTED','VERIFIED','FINALIZED')) = (reviewer_id IS NOT NULL))
);
CREATE INDEX submissions_owner_list ON submissions(owner_id, received_at DESC, id DESC);
CREATE INDEX submissions_queue ON submissions(status, received_at DESC, id DESC);
CREATE TABLE document_pages (
  submission_id uuid NOT NULL,
  template_id text NOT NULL,
  template_version integer NOT NULL,
  page_number integer NOT NULL,
  image_id uuid NOT NULL,
  object_key uuid NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png')),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, page_number),
  UNIQUE (submission_id, image_id),
  UNIQUE (submission_id, page_number, image_id),
  FOREIGN KEY (submission_id, template_id, template_version) REFERENCES submissions(id, template_id, template_version),
  FOREIGN KEY (template_id, template_version, page_number) REFERENCES template_pages
);
CREATE TABLE field_values (
  submission_id uuid NOT NULL,
  template_id text NOT NULL,
  template_version integer NOT NULL,
  field_key text NOT NULL,
  page_number integer NOT NULL,
  source_image_id uuid,
  ocr_original text,
  ocr_confidence double precision CHECK (ocr_confidence BETWEEN 0 AND 1),
  ocr_metadata jsonb,
  mobile_value text NOT NULL,
  mobile_confirmed boolean NOT NULL,
  review_value text,
  final_value text,
  PRIMARY KEY (submission_id, field_key),
  FOREIGN KEY (submission_id, template_id, template_version) REFERENCES submissions(id, template_id, template_version),
  FOREIGN KEY (template_id, template_version, field_key, page_number) REFERENCES template_fields(template_id, template_version, field_key, page_number),
  FOREIGN KEY (submission_id, page_number, source_image_id) REFERENCES document_pages(submission_id, page_number, image_id),
  CHECK ((source_image_id IS NULL) = (ocr_original IS NULL)),
  CHECK (source_image_id IS NOT NULL OR (ocr_confidence IS NULL AND ocr_metadata IS NULL))
);
CREATE TABLE verification_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES submissions(id),
  verifier_id uuid NOT NULL REFERENCES users(id),
  outcome text NOT NULL CHECK (outcome IN ('CLAIM','CORRECT','VERIFY','RETURN','REJECT','FINALIZE')),
  notes text,
  revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, revision),
  UNIQUE (id, submission_id)
);
CREATE TABLE verification_changes (
  verification_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  field_key text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (verification_id, field_key),
  FOREIGN KEY (verification_id, submission_id) REFERENCES verification_records(id, submission_id),
  FOREIGN KEY (submission_id, field_key) REFERENCES field_values
);
CREATE TABLE sync_operations (
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key uuid NOT NULL,
  submission_id uuid NOT NULL REFERENCES submissions(id),
  operation text NOT NULL,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_status integer NOT NULL CHECK (response_status BETWEEN 200 AND 299),
  response_revision integer NOT NULL,
  response_state submission_state NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, idempotency_key)
);
CREATE INDEX sync_operations_submission ON sync_operations(submission_id);
CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  submission_id uuid REFERENCES submissions(id),
  target_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_submission ON audit_logs(submission_id, created_at, id);
CREATE FUNCTION prevent_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit log is append-only'; END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_logs
FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_change();

CREATE FUNCTION protect_field_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.submission_id, NEW.template_id, NEW.template_version, NEW.field_key, NEW.page_number,
      NEW.source_image_id, NEW.ocr_original, NEW.ocr_confidence, NEW.ocr_metadata,
      NEW.mobile_value, NEW.mobile_confirmed)
    IS DISTINCT FROM
     (OLD.submission_id, OLD.template_id, OLD.template_version, OLD.field_key, OLD.page_number,
      OLD.source_image_id, OLD.ocr_original, OLD.ocr_confidence, OLD.ocr_metadata,
      OLD.mobile_value, OLD.mobile_confirmed)
  THEN RAISE EXCEPTION 'original mobile evidence is immutable'; END IF;
  IF OLD.final_value IS NOT NULL AND NEW.final_value IS DISTINCT FROM OLD.final_value
  THEN RAISE EXCEPTION 'final field value is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_field_evidence BEFORE UPDATE ON field_values FOR EACH ROW EXECUTE FUNCTION protect_field_evidence();
