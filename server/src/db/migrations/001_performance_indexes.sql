CREATE INDEX IF NOT EXISTS idx_records_dataset_id ON records(dataset_id);
CREATE INDEX IF NOT EXISTS idx_record_values_lookup ON record_values(record_id, field_id);
CREATE INDEX IF NOT EXISTS idx_fields_dataset_id ON fields(dataset_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_field ON audit_logs(record_id, field_id);
