import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

type SubjectInput = { slug: string; title: string; description: string };
type TopicInput = { subjectSlug: string; title: string; description: string };
type QuestionInput = {
  topicTitle: string;
  type: 'single' | 'multiple';
  text: string;
  options: string[];
  // Some packs use zero-based indices in `correct`, others use values in `correctAnswer`.
  // Support both to allow seamless import.
  correct?: number | number[];
  correctAnswer?: string | string[];
  explanation: string;
};

async function upsertSubject(input: SubjectInput) {
  return prisma.subject.upsert({
    where: { slug: input.slug },
    update: { title: input.title, description: input.description },
    create: { slug: input.slug, title: input.title, description: input.description, icon: 'book' }
  });
}

async function createTopic(subjectId: string, input: TopicInput) {
  return prisma.topic.create({
    data: {
      subjectId,
      title: input.title,
      description: input.description,
      questionsCount: 0,
      difficulty: 'medium',
    }
  });
}

async function createQuestion(topicId: string, q: QuestionInput) {
  // Normalize correct answer: prefer `correctAnswer` (values). If absent, map `correct` indices to values.
  let normalizedCorrect: any = undefined;
  if (typeof q.correctAnswer !== 'undefined') {
    normalizedCorrect = q.correctAnswer as any;
  } else if (typeof q.correct !== 'undefined') {
    if (Array.isArray(q.correct)) {
      normalizedCorrect = (q.correct as number[]).map((i) => q.options[i]);
    } else {
      normalizedCorrect = q.options[q.correct as number];
    }
  } else {
    normalizedCorrect = null;
  }

  return prisma.question.create({
    data: {
      topicId,
      text: q.text,
      type: q.type,
      options: q.options as any,
      correctAnswer: normalizedCorrect,
      explanation: q.explanation,
      difficulty: 'medium',
    }
  });
}

async function importBundle(bundleName: string) {
  const base = path.resolve(__dirname, 'seed', bundleName);
  const subjects: SubjectInput[] = JSON.parse(fs.readFileSync(path.join(base, 'subjects.json'), 'utf8'));
  const topics: TopicInput[] = JSON.parse(fs.readFileSync(path.join(base, 'topics.json'), 'utf8'));
  const questions: QuestionInput[] = JSON.parse(fs.readFileSync(path.join(base, 'questions.json'), 'utf8'));

  const slugToId = new Map<string, string>();
  for (const s of subjects) {
    const subj = await upsertSubject(s);
    slugToId.set(s.slug, subj.id);
  }

  const topicTitleToId = new Map<string, string>();
  for (const t of topics) {
    const subjectId = slugToId.get(t.subjectSlug);
    if (!subjectId) continue;
    const topic = await createTopic(subjectId, t);
    topicTitleToId.set(t.title, topic.id);
  }

  let created = 0;
  for (const q of questions) {
    const topicId = topicTitleToId.get(q.topicTitle);
    if (!topicId) continue;
    await createQuestion(topicId, q);
    created++;
  }
  console.log(`[${bundleName}] subjects=${subjects.length}, topics=${topics.length}, questions=${created}`);
}

async function main() {
  const bundle = process.argv[2];
  if (!bundle) {
    console.error('Usage: ts-node prisma/import.ts <bundle-name>');
    process.exit(1);
  }
  await importBundle(bundle);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });


