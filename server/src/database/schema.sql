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

    user_id INTEGER REFERENCES users(id),

    dataset_id INTEGER REFERENCES datasets(id),
    record_id INTEGER REFERENCES records(id),
    field_id INTEGER REFERENCES fields(id),

    action VARCHAR(50) NOT NULL,

    old_value TEXT,
    new_value TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 10. UPLOADED FILES
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

CREATE INDEX idx_records_dataset_id
ON records(dataset_id);

CREATE INDEX idx_record_values_record_id
ON record_values(record_id);

CREATE INDEX idx_record_values_field_id
ON record_values(field_id);

CREATE INDEX idx_audit_logs_user_id
ON audit_logs(user_id);

CREATE INDEX idx_audit_logs_dataset_id
ON audit_logs(dataset_id);

CREATE INDEX idx_audit_logs_record_id
ON audit_logs(record_id);

CREATE INDEX idx_uploaded_files_dataset_id
ON uploaded_files(dataset_id);