-- ============================================
-- QTech Data Management - Database Schema
-- ============================================

-- ============================================
-- 1. ROLES
-- ============================================

CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 2. USERS
-- ============================================

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 3. PERMISSIONS
-- ============================================

CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 4. ROLE PERMISSIONS
-- ============================================

CREATE TABLE role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- ============================================
-- 5. DATASETS
-- ============================================

CREATE TABLE datasets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP,
    source_file_name VARCHAR(255),
    row_count INTEGER,
    column_count INTEGER,
    schema JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 6. FIELDS / COLUMNS
-- ============================================

CREATE TABLE fields (
    id SERIAL PRIMARY KEY,
    dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    field_key VARCHAR(255) NOT NULL,
    field_type VARCHAR(50) DEFAULT 'text',
    position INTEGER NOT NULL DEFAULT 0,
    is_required BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    group_name VARCHAR(120),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(dataset_id, field_key)
);

-- ============================================
-- 7. RECORDS / ROWS
-- ============================================

CREATE TABLE records (
    id SERIAL PRIMARY KEY,
    dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    is_deleted BOOLEAN DEFAULT FALSE,
    position INTEGER,
    data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 8. RECORD VALUES
-- ============================================

CREATE TABLE record_values (
    id SERIAL PRIMARY KEY,
    record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    value TEXT,
    updated_by INTEGER REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(record_id, field_id)
);

-- ============================================
-- 9. AUDIT LOGS
-- ============================================

CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    record_id INTEGER REFERENCES records(id),
    field_id INTEGER REFERENCES fields(id),
    changed_by INTEGER REFERENCES users(id),
    old_value TEXT,
    new_value TEXT,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 10. FIELD PERMISSIONS
-- ============================================

CREATE TABLE field_permissions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    can_view BOOLEAN NOT NULL DEFAULT TRUE,
    can_edit BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (user_id, field_id)
);

-- ============================================
-- 11. UPLOADED FILES
-- ============================================

CREATE TABLE uploaded_files (
    id SERIAL PRIMARY KEY,

    dataset_id INTEGER REFERENCES datasets(id) ON DELETE SET NULL,

    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255),
    file_path TEXT,

    uploaded_by INTEGER REFERENCES users(id),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_users_role_id
ON users(role_id);

CREATE INDEX idx_datasets_created_by
ON datasets(created_by);

CREATE INDEX idx_fields_dataset_id
ON fields(dataset_id);

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    dataset_id INTEGER REFERENCES datasets(id) ON DELETE CASCADE,
    record_id INTEGER REFERENCES records(id) ON DELETE SET NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_records_dataset_id
ON records(dataset_id);

CREATE INDEX idx_record_values_record_id
ON record_values(record_id);

CREATE INDEX idx_record_values_field_id
ON record_values(field_id);

CREATE INDEX idx_record_values_lookup
ON record_values(record_id, field_id);

CREATE INDEX idx_audit_logs_changed_by
ON audit_logs(changed_by);

CREATE INDEX idx_audit_logs_record_id
ON audit_logs(record_id);

CREATE INDEX idx_audit_logs_field_id
ON audit_logs(field_id);

CREATE INDEX idx_audit_logs_record_field
ON audit_logs(record_id, field_id);

CREATE INDEX idx_uploaded_files_dataset_id
ON uploaded_files(dataset_id);

CREATE INDEX idx_field_permissions_field_id
ON field_permissions(field_id);

CREATE INDEX idx_records_dataset_position
ON records(dataset_id, position);