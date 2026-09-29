const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  getDatasets,
  createDataset,
  getDataset,
  addField,
  getRecords,
  createRecord,
  deleteRecord,
} = require("../controllers/datasetController");

const router = express.Router();

router.use(requireAuth);
router.get("/", getDatasets);
router.post("/", createDataset);
router.get("/:id/records", getRecords);
router.post("/:id/records", createRecord);
router.delete("/:id/records/:recordId", deleteRecord);
router.get("/:id", getDataset);
router.post("/:id/fields", addField);

module.exports = router;
