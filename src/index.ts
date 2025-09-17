import express, { Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import fetch from 'node-fetch';
import bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

// Расширяем тип Request для добавления user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
      };
    }
  }
}

// Load environment variables
dotenv.config();

// Extend global interface for auth codes
declare global {
  var authCodes: Map<string, { email?: string; phone?: string; expiresAt: Date }> | undefined;
}

// Email configuration
const emailTransporter = nodemailer.createTransport({
  service: 'yandex',
  auth: {
    user: process.env.EMAIL_USER || 'your-email@yandex.ru',
    pass: process.env.EMAIL_PASS || 'your-app-password'
  }
});

// SMS configuration (SMS.ru)
const SMS_API_ID = process.env.SMS_API_ID || '';
const SMS_FROM = process.env.SMS_FROM || '';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:8081', 'http://localhost:3000', 'http://127.0.0.1:8081', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'ЮрТренажёр API', 
    version: '1.0.0',
    status: 'running'
  });
});

// Local auth (username/password)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email, phone } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'username и password обязательны' });
    }

    const existing = await prisma.user.findFirst({ where: { OR: [ { username }, email ? { email } : undefined, phone ? { phone } : undefined ].filter(Boolean) as any } });
    if (existing) {
      return res.status(400).json({ error: 'Пользователь с такими данными уже существует' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { username, passwordHash, email: email || null, phone: phone || null, name: username }
    });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: { id: user.id, username: user.username, email: user.email, phone: user.phone }, token });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username и password обязательны' });
    }

    const user = await prisma.user.findFirst({ where: { OR: [ { username }, { email: username }, { phone: username } ] } });
    if (!user || !user.passwordHash) {
      return res.status(400).json({ error: 'Неверные учетные данные' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(400).json({ error: 'Неверные учетные данные' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: { id: user.id, username: user.username, email: user.email, phone: user.phone }, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Simple JWT auth middleware
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.user = { id: payload.userId, username: '' };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// Current user endpoint
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, email: true, phone: true, name: true } });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ user });
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Stats: summary with attempts by day and mastery/review counts
app.get('/api/stats/summary', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    // Fetch attempts (last 30 days) and progress
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [attempts, progress] = await Promise.all([
      prisma.quizAttempt.findMany({
        where: { userId, completedAt: { gte: since } },
        orderBy: { completedAt: 'asc' },
        select: { id: true, score: true, completedAt: true },
      }),
      prisma.userProgress.findMany({ where: { userId }, select: { masteryLevel: true } })
    ]);

    const totalAttempts = attempts.length;
    const avgScore = totalAttempts > 0 ? Math.round(attempts.reduce((s, a) => s + a.score, 0) / totalAttempts) : 0;

    const masteredTopics = progress.filter(p => p.masteryLevel >= 3).length;
    const reviewTopics = progress.filter(p => p.masteryLevel < 3).length;

    // Group attempts by day (YYYY-MM-DD)
    const attemptsByDayMap = new Map<string, { count: number; avgScore: number }>();
    for (const a of attempts) {
      const d = a.completedAt as unknown as Date;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const prev = attemptsByDayMap.get(key) || { count: 0, avgScore: 0 };
      const newCount = prev.count + 1;
      const newAvg = (prev.avgScore * prev.count + a.score) / newCount;
      attemptsByDayMap.set(key, { count: newCount, avgScore: newAvg });
    }

    // Return last 14 days window (fill empty days with zeros)
    const days: Array<{ date: string; count: number; avgScore: number }> = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const val = attemptsByDayMap.get(key) || { count: 0, avgScore: 0 };
      days.push({ date: key, count: val.count, avgScore: Math.round(val.avgScore) });
    }

    res.json({ totalAttempts, avgScore, masteredTopics, reviewTopics, days });
  } catch (error) {
    console.error('Stats summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Stats: attempts history (paginated)
app.get('/api/stats/attempts', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 100);
    const cursor = req.query.cursor as string | undefined;

    const results = await prisma.quizAttempt.findMany({
      where: { userId },
      orderBy: { completedAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, topicId: true, score: true, totalQuestions: true, correctAnswers: true, completedAt: true }
    });

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, -1) : results;

    // Optionally enrich with topic title
    const topicIds = Array.from(new Set(items.map(i => i.topicId)));
    const topics = await prisma.topic.findMany({ where: { id: { in: topicIds } }, select: { id: true, title: true } });
    const topicMap = new Map(topics.map(t => [t.id, t.title] as const));

    res.json({
      items: items.map(i => ({
        id: i.id,
        topicId: i.topicId,
        topicTitle: topicMap.get(i.topicId) || '',
        score: i.score,
        totalQuestions: i.totalQuestions,
        correctAnswers: i.correctAnswers,
        createdAt: i.completedAt
      })),
      nextCursor: hasMore ? items[items.length - 1].id : null
    });
  } catch (error) {
    console.error('Attempts history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Goals API
app.post('/api/goals', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { name, type, targetPerDay, startDate, endDate } = req.body;
    const goal = await prisma.goal.create({
      data: {
        userId,
        name,
        type,
        targetPerDay: Number(targetPerDay) || 1,
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : null,
        isActive: true,
      }
    });
    res.json({ goal });
  } catch (error) {
    console.error('Create goal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/goals', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const goals = await prisma.goal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    res.json({ goals });
  } catch (error) {
    console.error('List goals error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/goals/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const { name, type, targetPerDay, isActive, endDate } = req.body;
    const goal = await prisma.goal.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(targetPerDay !== undefined ? { targetPerDay: Number(targetPerDay) } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
        ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {}),
      }
    });
    if (goal.userId !== userId) return res.status(403).json({ error: 'Forbidden' });
    res.json({ goal });
  } catch (error) {
    console.error('Update goal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Goals summary: progress vs target for the last 14 days
app.get('/api/goals/summary', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;
    const goals = await prisma.goal.findMany({ where: { userId, isActive: true } });
    const since = new Date();
    since.setDate(since.getDate() - 14);
    const attempts = await prisma.quizAttempt.findMany({
      where: { userId, completedAt: { gte: since } },
      orderBy: { completedAt: 'asc' },
      select: { completedAt: true }
    });
    const byDay = new Map<string, number>();
    for (const a of attempts) {
      const d = a.completedAt as unknown as Date;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      byDay.set(key, (byDay.get(key) || 0) + 1);
    }
    const days: Array<{ date: string; attempts: number }> = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ date: key, attempts: byDay.get(key) || 0 });
    }
    // For now, progress per goal uses attempts per day.
    const goalsWithProgress = goals.map(g => ({
      ...g,
      progressDays: days.map(d => ({ date: d.date, value: d.attempts }))
    }));
    res.json({ goals: goalsWithProgress, days });
  } catch (error) {
    console.error('Goals summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// -----------------------------
// Progress & SM-2 (light) API
// -----------------------------

function getNextIntervalDaysByMastery(masteryLevel: number): number {
  // Простая лестница интервалов без EF: 0,1,2,3,4,5 → дни
  const mapping = [1, 2, 4, 7, 14, 30];
  const idx = Math.max(0, Math.min(masteryLevel, mapping.length - 1));
  return mapping[idx];
}

app.get('/api/progress/summary', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId as string;

    const [attempts, progress] = await Promise.all([
      prisma.quizAttempt.findMany({ where: { userId } }),
      prisma.userProgress.findMany({ where: { userId } })
    ]);

    const totalAttempts = attempts.length;
    const avgScore = totalAttempts > 0 ? Math.round(attempts.reduce((s, a) => s + a.score, 0) / totalAttempts) : 0;
    
    // Простая логика: masteryLevel >= 3 = освоена, < 3 = к повторению
    const masteredTopics = progress.filter(p => p.masteryLevel >= 3).length;
    const dueCount = progress.filter(p => p.masteryLevel < 3).length;

    res.json({
      totalAttempts,
      avgScore,
      masteredTopics,
      totalTrackedTopics: progress.length,
      dueCount
    });
  } catch (error) {
    console.error('Progress summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/review/due', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId as string;

    const due = await prisma.userProgress.findMany({
      where: {
        userId,
        masteryLevel: { lt: 3 }, // Теми к повторению (не освоенные)
      },
      include: {
        topic: { select: { id: true, title: true, difficulty: true, questionsCount: true, subject: { select: { title: true, slug: true } } } }
      },
      orderBy: [
        { nextReview: 'asc' },
        { updatedAt: 'desc' }
      ],
      take: 20
    });

    res.json({
      total: due.length,
      items: due.map(d => ({
        topicId: d.topicId,
        masteryLevel: d.masteryLevel,
        nextReview: d.nextReview,
        topicTitle: (d as any).topic.title,
        subjectTitle: (d as any).topic.subject.title,
        subjectSlug: (d as any).topic.subject.slug,
        questionsCount: (d as any).topic.questionsCount,
        difficulty: (d as any).topic.difficulty,
      }))
    });
  } catch (error) {
    console.error('Review due error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/review/grade', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const { topicId, quality } = req.body as { topicId?: string; quality?: number };

    if (!topicId || quality === undefined) {
      return res.status(400).json({ error: 'topicId и quality обязательны' });
    }
    if (quality < 0 || quality > 5) {
      return res.status(400).json({ error: 'quality должен быть в диапазоне 0..5' });
    }

    // Найти или создать запись прогресса
    let progress = await prisma.userProgress.findFirst({ where: { userId, topicId } });
    if (!progress) {
      progress = await prisma.userProgress.create({ data: { userId, topicId, masteryLevel: 0 } });
    }

    let newMastery = progress.masteryLevel;
    let nextDays = 1;

    if (quality >= 3) {
      newMastery = Math.min(5, progress.masteryLevel + 1);
      nextDays = getNextIntervalDaysByMastery(newMastery);
    } else {
      // провал — обнуляем уровень до 0 и даём ближайшее повторение
      newMastery = 0;
      nextDays = 1;
    }

    const now = new Date();
    const next = new Date(now.getTime() + nextDays * 24 * 60 * 60 * 1000);

    const updated = await prisma.userProgress.update({
      where: { id: progress.id },
      data: {
        masteryLevel: newMastery,
        lastReviewed: now,
        nextReview: next
      }
    });

    res.json({
      success: true,
      masteryLevel: updated.masteryLevel,
      nextReview: updated.nextReview
    });
  } catch (error) {
    console.error('Review grade error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Subjects routes
app.get('/api/subjects', async (req, res) => {
  try {
    const subjects = await prisma.subject.findMany({
      where: { isActive: true },
      include: {
        topics: {
          where: { isActive: true },
          select: { id: true, title: true, questionsCount: true, difficulty: true }
        }
      },
      orderBy: { title: 'asc' }
    });

    // Update topicsCount
    const subjectsWithCount = subjects.map(subject => ({
      ...subject,
      topicsCount: subject.topics.length
    }));

    res.json(subjectsWithCount);
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/subjects/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    const subject = await prisma.subject.findUnique({
      where: { slug },
      include: {
        topics: {
          where: { isActive: true },
          orderBy: { title: 'asc' }
        }
      }
    });

    if (!subject) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    res.json(subject);
  } catch (error) {
    console.error('Error fetching subject:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Topics routes
app.get('/api/topics/:topicId/questions', async (req, res) => {
  try {
    const { topicId } = req.params;
    
    const questions = await prisma.question.findMany({
      where: { 
        topicId,
        isActive: true 
      },
      orderBy: { createdAt: 'asc' }
    });

    res.json(questions);
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Quiz attempt route
app.post('/api/quiz/attempt', requireAuth, async (req, res) => {
  try {
    const { topicId, score, totalQuestions, correctAnswers } = req.body;
    const userId = req.user!.id;
    
    console.log('Quiz attempt request:', { topicId, score, totalQuestions, correctAnswers, userId });

    const attempt = await prisma.quizAttempt.create({
      data: {
        userId,
        topicId,
        score,
        totalQuestions,
        correctAnswers
      }
    });

    console.log('Quiz attempt created:', attempt);
    res.json(attempt);
  } catch (error) {
    console.error('Error saving quiz attempt:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { q: query, type } = req.query;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const searchQuery = `%${query.toLowerCase()}%`;
    let results = [];

    if (!type || type === 'all' || type === 'subjects') {
      // Search subjects
      const subjects = await prisma.subject.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } }
          ],
          isActive: true
        },
        include: {
          topics: {
            where: { isActive: true },
            select: { id: true, title: true }
          }
        }
      });
      
      results.push(...subjects.map(subject => ({
        type: 'subject',
        id: subject.id,
        title: subject.title,
        description: subject.description,
        slug: subject.slug,
        icon: subject.icon,
        topicsCount: subject.topics.length
      })));
    }

    if (!type || type === 'all' || type === 'topics') {
      // Search topics
      const topics = await prisma.topic.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } }
          ],
          isActive: true
        },
        include: {
          subject: {
            select: { title: true, slug: true, icon: true }
          }
        }
      });
      
      results.push(...topics.map(topic => ({
        type: 'topic',
        id: topic.id,
        title: topic.title,
        description: topic.description,
        difficulty: topic.difficulty,
        questionsCount: topic.questionsCount,
        subjectTitle: topic.subject.title,
        subjectSlug: topic.subject.slug,
        subjectIcon: topic.subject.icon
      })));
    }

    if (!type || type === 'all' || type === 'questions') {
      // Search questions
      const questions = await prisma.question.findMany({
        where: {
          OR: [
            { text: { contains: query, mode: 'insensitive' } },
            { explanation: { contains: query, mode: 'insensitive' } }
          ],
          isActive: true
        },
        include: {
          topic: {
            select: { title: true, subject: { select: { title: true, slug: true } } }
          }
        },
        take: 20 // Limit questions to avoid too many results
      });
      
      results.push(...questions.map(question => ({
        type: 'question',
        id: question.id,
        text: question.text,
        topicTitle: question.topic.title,
        subjectTitle: question.topic.subject.title,
        subjectSlug: question.topic.subject.slug
      })));
    }

    res.json({
      query,
      results,
      total: results.length
    });
  } catch (error) {
    console.error('Error searching:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Email auth endpoints
app.post('/api/auth/send-email-code', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Store code in database
    const authCodes = global.authCodes || new Map();
    authCodes.set(code, {
      email,
      expiresAt
    });
    
    global.authCodes = authCodes;

    // Send email with code
    try {
      await emailTransporter.sendMail({
        from: process.env.EMAIL_USER || 'your-email@gmail.com',
        to: email,
        subject: 'Код авторизации - ЮрТренажёр',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #d52b1e; text-align: center;">🔐 Код авторизации</h2>
            <p>Ваш код для входа в приложение ЮрТренажёр:</p>
            <div style="background: #f8f9fa; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
              <h1 style="color: #d52b1e; font-size: 32px; margin: 0; letter-spacing: 4px;">${code}</h1>
            </div>
            <p>⏰ Код действителен 5 минут</p>
            <p>Если вы не запрашивали этот код, просто проигнорируйте это письмо.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #666; font-size: 12px; text-align: center;">
              ЮрТренажёр - Ваш помощник в изучении юриспруденции
            </p>
          </div>
        `
      });
      
      console.log(`Email sent to ${email} with code: ${code}`);
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      // Still return success for testing, but log the error
    }

    res.json({ 
      success: true, 
      message: 'Код отправлен на email'
    });
  } catch (error) {
    console.error('Error sending email code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/verify-email-code', async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    // Check if code exists and is not expired
    const authCodes = global.authCodes || new Map();
    const codeData = authCodes.get(code);
    
    if (!codeData) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    if (new Date() > codeData.expiresAt) {
      authCodes.delete(code);
      return res.status(400).json({ error: 'Code expired' });
    }

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email: codeData.email }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: codeData.email,
          name: codeData.email.split('@')[0] // Use email prefix as name
        }
      });
    }

    // Clean up code
    authCodes.delete(code);

    res.json({ 
      success: true, 
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Error verifying code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// SMS auth endpoints
app.post('/api/auth/send-sms-code', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone is required' });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Store code in memory
    const authCodes = global.authCodes || new Map();
    authCodes.set(code, { phone, expiresAt });
    global.authCodes = authCodes;

    // Send SMS via SMS.ru
    try {
      if (!SMS_API_ID) {
        console.warn('SMS_API_ID is not set; skipping actual SMS send');
      } else {
        const params = new URLSearchParams({
          api_id: SMS_API_ID,
          to: phone,
          msg: `Код входа: ${code}`,
          from: SMS_FROM,
          json: '1'
        });
        const response = await fetch(`https://sms.ru/sms/send?${params.toString()}`);
        const data = await response.json();
        console.log('SMS.ru response:', data);
      }
    } catch (smsError) {
      console.error('SMS sending error:', smsError);
      // не падаем из-за SMS ошибок в dev
    }

    res.json({ success: true, message: 'Код отправлен по SMS' });
  } catch (error) {
    console.error('Error sending sms code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/verify-sms-code', async (req, res) => {
  try {
    const { code, phone } = req.body;

    if (!code || !phone) {
      return res.status(400).json({ error: 'Code and phone are required' });
    }

    const authCodes = global.authCodes || new Map();
    const codeData = authCodes.get(code);

    if (!codeData || codeData.phone !== phone) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    if (new Date() > codeData.expiresAt) {
      authCodes.delete(code);
      return res.status(400).json({ error: 'Code expired' });
    }

    // Find or create user by phone
    let user = await prisma.user.findFirst({ where: { phone } });
    if (!user) {
      user = await prisma.user.create({ data: { phone, name: phone } });
    }

    authCodes.delete(code);
    res.json({ success: true, user: { id: user.id, phone: user.phone, name: user.name } });
  } catch (error) {
    console.error('Error verifying sms code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', database: 'disconnected' });
  }
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📚 ЮрТренажёр API готов к работе!`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

