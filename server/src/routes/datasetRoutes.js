const express = require("express");
const multer = require("multer");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  getDatasets,
  createDataset,
  getDataset,
  addField,
  getRecords,
  createRecord,
  deleteRecord,
  updateCell,
  getAuditLogs,
} = require("../controllers/datasetController");
const { previewExcel, importExcel, exportExcel } = require("../controllers/excelController");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function excelUpload(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Excel files must be 15 MB or smaller" });
    }
    return res.status(400).json({ error: error.message || "Unable to read the uploaded file" });
  });
}

router.use(requireAuth);
router.get("/", getDatasets);
router.post("/", createDataset);
router.get("/:id/records", getRecords);
router.post("/:id/records", createRecord);
router.delete("/:id/records/:recordId", deleteRecord);
router.patch("/:id/records/:recordId/cells", updateCell);
router.get("/:id/audit-logs", getAuditLogs);
router.post("/:id/preview-excel", excelUpload, previewExcel);
router.post("/:id/import-excel", excelUpload, importExcel);
router.get("/:id/export-excel", exportExcel);
router.get("/:id", getDataset);
router.post("/:id/fields", addField);

module.exports = router;
