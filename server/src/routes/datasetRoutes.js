const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  getDatasets,
  createDataset,
  getDataset,
  addField,
} = require("../controllers/datasetController");

const router = express.Router();

router.use(requireAuth);
router.get("/", getDatasets);
router.post("/", createDataset);
router.get("/:id", getDataset);
router.post("/:id/fields", addField);

module.exports = router;
