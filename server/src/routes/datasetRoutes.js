const express = require("express");
const multer = require("multer");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  getDatasets,
  createDataset,
  addField,
  getRecords,
  createRecord,
  deleteRecord,
  softDeleteDataset,
  restoreDataset,
  updateCell,
  updateDataset,
  deleteField,
  getAuditLogs,
} = require("../controllers/datasetController");
const { getFieldPermissions, saveFieldPermissions } = require("../controllers/permissionController");
const { previewExcel, importExcel, exportExcel } = require("../controllers/excelController");
const {
  importSheet,
  getSheet,
  getRows,
  createSheetRow,
  patchSheetRow,
  deleteSheetRow,
  renameColumn,
  exportSheet,
} = require("../controllers/sheetController");
const { validateRecord, verifyRecord, updateProposal } = require("../controllers/workflowController");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function rejectInvalidInteger(paramName, label) {
  return (req, res, next, value) => {
    if (!/^\d+$/.test(String(value))) {
      return res.status(400).json({ error: `Invalid ${label}` });
    }
    req.params[paramName] = String(Number(value));
    return next();
  };
}

function sheetUpload(req, res, next) {
  importUpload.single("file")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Excel files must be 25 MB or smaller." });
    }
    return res.status(400).json({ error: "This workbook is corrupt or password-protected." });
  });
}

function excelUpload(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Excel files must be 15 MB or smaller" });
    }
    return res.status(400).json({ error: error.message || "Unable to read the uploaded file" });
  });
}

router.param("id", rejectInvalidInteger("id", "id"));
router.param("recordId", rejectInvalidInteger("recordId", "record id"));
router.param("fieldId", rejectInvalidInteger("fieldId", "field id"));
router.param("rowId", rejectInvalidInteger("rowId", "row id"));
router.use(requireAuth);
router.get("/", getDatasets);
router.post("/import", sheetUpload, importSheet);
router.post("/", createDataset);
router.get("/:id/records", getRecords);
router.post("/:id/records", createRecord);
router.delete("/:id/records/:recordId", deleteRecord);
router.patch("/:id/records/:recordId/workflow/validate", validateRecord);
router.patch("/:id/records/:recordId/workflow/verify", verifyRecord);
router.patch("/:id/records/:recordId/workflow/proposal", updateProposal);
router.patch("/:id/records/:recordId/cells", updateCell);
router.get("/:id/audit-logs", getAuditLogs);
router.get("/:id/permissions", requireRole(["Admin"]), getFieldPermissions);
router.put("/:id/permissions", requireRole(["Admin"]), saveFieldPermissions);
router.post("/:id/preview-excel", excelUpload, previewExcel);
router.post("/:id/import-excel", excelUpload, importExcel);
router.get("/:id/export-excel", exportExcel);
router.get("/:id/export", exportSheet);
router.get("/:id/rows", getRows);
router.post("/:id/rows", createSheetRow);
router.patch("/:id/rows/:rowId", patchSheetRow);
router.delete("/:id/rows/:rowId", deleteSheetRow);
router.patch("/:id/columns/:key", renameColumn);
router.patch("/:id/restore", requireRole(["Admin"]), restoreDataset);
router.patch("/:id", updateDataset);
router.delete("/:id", requireRole(["Admin", "Manager"]), softDeleteDataset);
router.get("/:id", getSheet);
router.post("/:id/fields", requireRole(["Admin"]), addField);
router.delete("/:id/fields/:fieldId", requireRole(["Admin"]), deleteField);

module.exports = router;
