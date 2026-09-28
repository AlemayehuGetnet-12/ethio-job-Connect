import Job from "../models/Job.js";
import { botInstance } from '../telegram/bot.js';
import TelegramSubscription from '../models/TelegramSubscription.js';

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Public: GET /api/jobs?search|q=&city|location=&category=&type=&isRemote=&salaryMin=&salaryMax=&sort=&page=&limit=
export const listJobs = async (req, res, next) => {
  try {
    // pagination & filtering
    const page = Math.max(1, parseInt(req.query.page)) || 1;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit))) || 10;
    const skip = (page - 1) * limit;

    const q = { isActive: true };

    // only show jobs whose deadline hasn't passed
    const andClauses = [{ $or: [{ deadline: { $exists: false } }, { deadline: null }, { deadline: { $gte: new Date() } }] }];

    const keyword = (req.query.search || req.query.q || '').toString().trim().slice(0, 100);
    if (keyword) {
      const re = new RegExp(escapeRe(keyword), 'i');
      const companies = await Company.find({ name: re }).select('_id').limit(50);
      const or = [{ title: re }, { description: re }, { skills: re }, { category: re }];
      if (companies.length) or.push({ company: { $in: companies.map(c => c._id) } });
      andClauses.push({ $or: or });
    }

    const city = (req.query.city || req.query.location || '').toString().trim().slice(0, 60);
    if (city) {
      // match "Adama" against "Adama (Nazret)" etc.
      const base = city.split('(')[0].trim();
      q.location = new RegExp(escapeRe(base), 'i');
    }

    const category = (req.query.category || '').toString().trim().slice(0, 60);
    if (category) q.category = new RegExp(`^${escapeRe(category)}$`, 'i');

    if (req.query.type) q.type = req.query.type;
    if (req.query.isRemote) q.isRemote = req.query.isRemote === 'true';
    q.$and = andClauses;

    // salary range
    const salaryMin = req.query.salaryMin ? Number(req.query.salaryMin) : null;
    const salaryMax = req.query.salaryMax ? Number(req.query.salaryMax) : null;
    if (salaryMin !== null || salaryMax !== null) {
      q.salary = {};
      if (salaryMin !== null) q.salary.$gte = salaryMin;
      if (salaryMax !== null) q.salary.$lte = salaryMax;
    }

    // sorting support: sort param examples: date_desc (default), date_asc, salary_desc, salary_asc
    const sortParam = (req.query.sort || 'date_desc').toString();
    let sortObj = { createdAt: -1 };
    switch (sortParam) {
      case 'date_asc':
        sortObj = { createdAt: 1 };
        break;
      case 'salary_desc':
        sortObj = { salary: -1 };
        break;
      case 'salary_asc':
        sortObj = { salary: 1 };
        break;
      case 'relevance':
        // fallback to default ordering when relevance isn't implemented
        sortObj = { createdAt: -1 };
        break;
      case 'date_desc':
      default:
        sortObj = { createdAt: -1 };
    }

    const [jobs, total] = await Promise.all([
      Job.find(q).sort(sortObj).skip(skip).limit(limit),
      Job.countDocuments(q),
    ]);

    res.json({ jobs, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (error) {
    next(error);
  }
};

export const getJob = async (req, res, next) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }
    res.json({ job });
  } catch (error) {
    next(error);
  }
};

export const createJob = async (req, res, next) => {
  try {
    const { title, description, location, salary, salaryCurrency, type, category, skills, isRemote, deadline } = req.body;

    // basic server-side validation
    if (!title || !description || !location) {
      return res.status(400).json({ message: 'title, description, and location are required' });
    }

    const jobData = {
      title: String(title).trim(),
      description: String(description).trim(),
      location: String(location).trim(),
      employer: req.user.id,
      isRemote: Boolean(isRemote),
      type: type || 'full-time',
      category: category || undefined,
      skills: Array.isArray(skills) ? skills.map(String) : [],
    };

    if (salary !== undefined && salary !== null && salary !== '') jobData.salary = Number(salary);
    jobData.salaryCurrency = salaryCurrency || 'ETB';
    if (deadline) jobData.deadline = new Date(deadline);

    const job = await Job.create(jobData);
    res.status(201).json({ job });

    // Send Telegram notifications (non-blocking). Supports TELEGRAM_CHAT_IDS (comma-separated)
    const chatIdsEnv = process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID;
    if (chatIdsEnv && botInstance && typeof botInstance.sendMessage === 'function') {
      const chatIds = chatIdsEnv.split(',').map(s => s.trim()).filter(Boolean);
      (async () => {
        try {
          const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
          const url = `${frontend.replace(/\/$/, '')}/jobs/${job._id}`;
          const titleText = job.title || 'Untitled';
          const company = job.company ? ` — ${job.company}` : '';
          const text = `📢 New Job Posted!\n${titleText}${company}\n${url}`;
          for (const cid of chatIds) {
            try {
              await botInstance.sendMessage(cid, text);
            } catch (sendErr) {
              console.error('Failed to send Telegram notification to', cid, sendErr.message || sendErr);
            }
          }
        } catch (e) {
          // swallow errors to avoid affecting API response
          console.error('Failed to send Telegram notifications:', e.message || e);
        }
      })();
    }

    // Notify individual subscribers whose filters match this job (non-blocking)
    try {
      if (botInstance && typeof botInstance.sendMessage === 'function') {
        const subs = await TelegramSubscription.find({ active: true });
        const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
        const url = `${frontend.replace(/\/$/, '')}/jobs/${job._id}`;

        const textForJob = (s, j) => {
          const titleText = j.title || 'Untitled';
          const company = j.company ? ` — ${j.company}` : '';
          return `📢 New Job: ${titleText}${company}\n${j.location || ''} \n${url}`;
        };

        (async () => {
          for (const s of subs) {
            try {
              // match simple filters: if keywords present, check title/description contains any; also match locations/categories if provided
              let matched = false;
              if (!s.keywords?.length && !s.locations?.length && !s.categories?.length) {
                matched = true; // broadcast to subscribers with no filters
              } else {
                const titleDesc = `${job.title || ''} ${job.description || ''}`.toLowerCase();
                if (s.keywords && s.keywords.some(k => titleDesc.includes(k.toLowerCase()))) matched = true;
                if (!matched && s.locations && s.locations.some(loc => (job.location || '').toLowerCase().includes(loc.toLowerCase()))) matched = true;
                if (!matched && s.categories && s.categories.some(cat => (job.category || '').toLowerCase() === cat.toLowerCase())) matched = true;
              }

              if (matched) {
                await botInstance.sendMessage(s.chatId, textForJob(s, job));
              }
            } catch (err) {
              console.warn('Failed to notify subscription', s && s.chatId, err.message || err);
            }
          }
        })();
      }
    } catch (e) {
      console.error('Failed to process telegram subscriptions:', e.message || e);
    }

  } catch (error) {
    next(error);
  }
};

export const updateJob = async (req, res, next) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    // Only admin or the employer who created the job can update it
    const requesterId = req.user?.id?.toString ? req.user.id.toString() : String(req.user?.id);
    const ownerId = job.employer?.toString ? job.employer.toString() : String(job.employer);
    if (req.user.role !== "admin" && ownerId !== requesterId) {
      return res.status(403).json({ message: "Forbidden - you are not allowed to update this job" });
    }

    // apply updates safely
    Object.assign(job, req.body);
    await job.save();
    res.json({ job });
  } catch (error) {
    next(error);
  }
};

export const deleteJob = async (req, res, next) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    const requesterId = req.user?.id?.toString ? req.user.id.toString() : String(req.user?.id);
    const ownerId = job.employer?.toString ? job.employer.toString() : String(job.employer);
    if (req.user.role !== "admin" && ownerId !== requesterId) {
      return res.status(403).json({ message: "Forbidden - you are not allowed to delete this job" });
    }

    await job.deleteOne();
    res.json({ message: "Job deleted successfully" });
  } catch (error) {
    next(error);
  }
};

export const recommendJobs = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Authentication required' });

    const criteria = { isActive: true };
    const ands = [];
    if (user.skills && Array.isArray(user.skills) && user.skills.length > 0) {
      ands.push({ skills: { $in: user.skills } });
    }
    if (user.location) {
      ands.push({ location: user.location });
    }
    if (ands.length > 0) {
      criteria.$or = ands;
    }

    const jobs = await Job.find(criteria).sort({ createdAt: -1 }).limit(20);
    res.json({ jobs });
  } catch (error) {
    next(error);
  }
};

export default { listJobs, getJob, createJob, updateJob, deleteJob, recommendJobs };
