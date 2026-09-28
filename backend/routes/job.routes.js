import express from "express";
import { getJobFilters, listJobs, getJob, createJob, updateJob, deleteJob, recommendJobs } from "../controllers/job.controller.js";
import { protect, authorizeRoles } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", listJobs);
router.get("/filters", getJobFilters);
router.get('/recommendations', protect, recommendJobs);
router.get("/:id", getJob);
router.post("/", protect, authorizeRoles("employer", "admin"), createJob);
router.put("/:id", protect, authorizeRoles("employer", "admin"), updateJob);
router.delete("/:id", protect, authorizeRoles("admin"), deleteJob);

export default router;
