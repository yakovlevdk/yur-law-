import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

// Load environment variables
dotenv.config();

// Extend global interface for auth codes
declare global {
  var authCodes: Map<string, { email: string; expiresAt: Date }> | undefined;
}

// Email configuration
const emailTransporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-app-password'
  }
});

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

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
app.post('/api/quiz/attempt', async (req, res) => {
  try {
    const { userId, topicId, score, totalQuestions, correctAnswers } = req.body;

    const attempt = await prisma.quizAttempt.create({
      data: {
        userId: userId || null,
        topicId,
        score,
        totalQuestions,
        correctAnswers
      }
    });

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

