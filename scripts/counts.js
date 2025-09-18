const { PrismaClient } = require('../node_modules/@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const subjects = await prisma.subject.count();
    const topics = await prisma.topic.count();
    const questions = await prisma.question.count();
    console.log(JSON.stringify({ subjects, topics, questions }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });


