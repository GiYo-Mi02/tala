# T.A.L.A. Phase 2.1 database relationships

Crow’s feet show the number of child rows per parent. A circle at the parent end means the child can omit that relationship. Each connector represents one foreign key, including keys that span several columns. See [the migration](../../apps/backend/migrations/0001_foundation.sql) for the complete column pairs and [the data dictionary](data-dictionary.md) for field descriptions.

```mermaid
erDiagram
    users {
        uuid id PK
        text email
        text password_hash
        user_role role
        boolean active
        timestamptz created_at
    }
    sessions {
        uuid id PK
        uuid user_id FK
        text access_hash
        text refresh_hash
        text mode
        timestamptz access_expires_at
        timestamptz refresh_expires_at
        timestamptz revoked_at
        timestamptz created_at
    }
    document_templates {
        text id PK
        integer version PK
        text name
        jsonb metadata
    }
    template_pages {
        text template_id PK, FK
        integer template_version PK, FK
        integer page_number PK
        integer display_order
        boolean capture
        boolean required
        text label
    }
    template_fields {
        text template_id PK, FK
        integer template_version PK, FK
        text field_key PK
        integer page_number FK
        text label
        text data_type
        integer display_order
        jsonb rules
    }
    submissions {
        uuid id PK
        uuid client_submission_id
        uuid owner_id FK
        text template_id FK
        integer template_version FK
        timestamptz captured_at
        timestamptz received_at
        timestamptz updated_at
        timestamptz completed_at
        submission_state status
        integer revision
        uuid reviewer_id FK
    }
    document_pages {
        uuid submission_id PK, FK
        text template_id FK
        integer template_version FK
        integer page_number PK, FK
        uuid image_id
        uuid object_key
        text mime_type
        integer byte_size
        integer width
        integer height
        text sha256
        timestamptz uploaded_at
    }
    field_values {
        uuid submission_id PK, FK
        text template_id FK
        integer template_version FK
        text field_key PK, FK
        integer page_number FK
        uuid source_image_id FK
        text ocr_original
        double_precision ocr_confidence
        jsonb ocr_metadata
        text mobile_value
        boolean mobile_confirmed
        text review_value
        text final_value
    }
    verification_records {
        uuid id PK
        uuid submission_id FK
        uuid verifier_id FK
        text outcome
        text notes
        integer revision
        timestamptz created_at
    }
    verification_changes {
        uuid verification_id PK, FK
        uuid submission_id FK
        text field_key PK, FK
        text value
    }
    sync_operations {
        uuid actor_id PK, FK
        uuid idempotency_key PK
        uuid submission_id FK
        text operation
        text request_sha256
        integer response_status
        integer response_revision
        submission_state response_state
        timestamptz created_at
    }
    audit_logs {
        bigint id PK
        uuid actor_id FK
        uuid submission_id FK
        uuid target_user_id FK
        text action
        jsonb details
        timestamptz created_at
    }
    users ||..o{ sessions : "user_id"
    document_templates ||--o{ template_pages : "template_id + template_version"
    template_pages ||..o{ template_fields : "template_id + template_version + page_number"
    users ||..o{ submissions : "owner_id"
    users |o..o{ submissions : "reviewer_id"
    document_templates ||..o{ submissions : "template_id + template_version"
    submissions ||..o{ document_pages : "submission_id + template_id + template_version"
    template_pages ||..o{ document_pages : "template_id + template_version + page_number"
    submissions ||..o{ field_values : "submission_id + template_id + template_version"
    template_fields ||..o{ field_values : "template_id + template_version + field_key + page_number"
    document_pages |o..o{ field_values : "submission_id + page_number + source_image_id"
    submissions ||..o{ verification_records : "submission_id"
    users ||..o{ verification_records : "verifier_id"
    verification_records ||..o{ verification_changes : "verification_id + submission_id"
    field_values ||..o{ verification_changes : "submission_id + field_key"
    users ||--o{ sync_operations : "actor_id"
    submissions ||..o{ sync_operations : "submission_id"
    users |o..o{ audit_logs : "actor_id"
    submissions |o..o{ audit_logs : "submission_id"
    users |o..o{ audit_logs : "target_user_id"
```
