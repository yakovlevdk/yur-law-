import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Начинаем заполнение базы данных...');

  // Создаем предметы
  const subjects = await Promise.all([
    prisma.subject.upsert({
      where: { slug: 'constitutional-law' },
      update: {},
      create: {
        slug: 'constitutional-law',
        title: 'Конституционное право',
        description: 'Основы конституционного строя, права и свободы человека и гражданина',
        icon: '🏛️',
        topicsCount: 4
      }
    }),
    prisma.subject.upsert({
      where: { slug: 'civil-law' },
      update: {},
      create: {
        slug: 'civil-law',
        title: 'Гражданское право',
        description: 'Гражданские правоотношения, собственность, обязательства',
        icon: '⚖️',
        topicsCount: 3
      }
    }),
    prisma.subject.upsert({
      where: { slug: 'criminal-law' },
      update: {},
      create: {
        slug: 'criminal-law',
        title: 'Уголовное право',
        description: 'Преступления и наказания, уголовная ответственность',
        icon: '🔒',
        topicsCount: 2
      }
    }),
    prisma.subject.upsert({
      where: { slug: 'administrative-law' },
      update: {},
      create: {
        slug: 'administrative-law',
        title: 'Административное право',
        description: 'Государственное управление, административные правонарушения',
        icon: '🏢',
        topicsCount: 1
      }
    }),
    prisma.subject.upsert({
      where: { slug: 'labor-law' },
      update: {},
      create: {
        slug: 'labor-law',
        title: 'Трудовое право',
        description: 'Трудовые отношения, права работников и работодателей',
        icon: '👷',
        topicsCount: 1
      }
    }),
    prisma.subject.upsert({
      where: { slug: 'family-law' },
      update: {},
      create: {
        slug: 'family-law',
        title: 'Семейное право',
        description: 'Брак, семья, права и обязанности супругов и детей',
        icon: '👨‍👩‍👧‍👦',
        topicsCount: 1
      }
    })
  ]);

  console.log('✅ Предметы созданы');

  // Создаем темы для конституционного права
  const constitutionalTopics = await Promise.all([
    prisma.topic.upsert({
      where: { id: 'constitutional-1' },
      update: {},
      create: {
        id: 'constitutional-1',
        subjectId: subjects[0].id,
        title: 'Основы конституционного строя',
        description: 'Принципы и основы конституционного строя Российской Федерации',
        questionsCount: 3,
        difficulty: 'medium'
      }
    }),
    prisma.topic.upsert({
      where: { id: 'constitutional-2' },
      update: {},
      create: {
        id: 'constitutional-2',
        subjectId: subjects[0].id,
        title: 'Права и свободы человека и гражданина',
        description: 'Конституционные права, свободы и обязанности граждан',
        questionsCount: 3,
        difficulty: 'hard'
      }
    }),
    prisma.topic.upsert({
      where: { id: 'constitutional-3' },
      update: {},
      create: {
        id: 'constitutional-3',
        subjectId: subjects[0].id,
        title: 'Федеративное устройство',
        description: 'Принципы федеративного устройства, субъекты РФ',
        questionsCount: 2,
        difficulty: 'medium'
      }
    }),
    prisma.topic.upsert({
      where: { id: 'constitutional-4' },
      update: {},
      create: {
        id: 'constitutional-4',
        subjectId: subjects[0].id,
        title: 'Президент Российской Федерации',
        description: 'Статус, полномочия и порядок избрания Президента',
        questionsCount: 2,
        difficulty: 'easy'
      }
    })
  ]);

  console.log('✅ Темы конституционного права созданы');

  // Создаем вопросы для первой темы
  const questions = await Promise.all([
    prisma.question.upsert({
      where: { id: 'q1' },
      update: {},
      create: {
        id: 'q1',
        topicId: constitutionalTopics[0].id,
        text: 'Сколько глав содержит Конституция РФ?',
        type: 'single',
        options: ['8 глав', '9 глав', '10 глав', '11 глав'],
        correctAnswer: '9 глав',
        explanation: 'Конституция РФ состоит из 9 глав: основы конституционного строя, права и свободы человека, федеративное устройство, президент, федеральное собрание, правительство, судебная власть, местное самоуправление, конституционные поправки.',
        difficulty: 'easy'
      }
    }),
    prisma.question.upsert({
      where: { id: 'q2' },
      update: {},
      create: {
        id: 'q2',
        topicId: constitutionalTopics[0].id,
        text: 'Какие принципы лежат в основе конституционного строя РФ?',
        type: 'multiple',
        options: ['Демократия', 'Федерализм', 'Правовое государство', 'Республиканская форма правления'],
        correctAnswer: ['Демократия', 'Федерализм', 'Правовое государство', 'Республиканская форма правления'],
        explanation: 'Все перечисленные принципы являются основами конституционного строя РФ согласно статье 1 Конституции.',
        difficulty: 'medium'
      }
    }),
    prisma.question.upsert({
      where: { id: 'q3' },
      update: {},
      create: {
        id: 'q3',
        topicId: constitutionalTopics[0].id,
        text: 'Российская Федерация является светским государством.',
        type: 'boolean',
        options: ['Да', 'Нет'],
        correctAnswer: 'Да',
        explanation: 'Согласно статье 14 Конституции РФ, Российская Федерация является светским государством. Никакая религия не может устанавливаться в качестве государственной или обязательной.',
        difficulty: 'easy'
      }
    })
  ]);

  console.log('✅ Вопросы созданы');

  // Создаем темы для гражданского права
  const civilTopics = await Promise.all([
    prisma.topic.upsert({
      where: { id: 'civil-1' },
      update: {},
      create: {
        id: 'civil-1',
        subjectId: subjects[1].id,
        title: 'Гражданские правоотношения',
        description: 'Понятие, виды и элементы гражданских правоотношений',
        questionsCount: 2,
        difficulty: 'medium'
      }
    }),
    prisma.topic.upsert({
      where: { id: 'civil-2' },
      update: {},
      create: {
        id: 'civil-2',
        subjectId: subjects[1].id,
        title: 'Право собственности',
        description: 'Понятие, виды и защита права собственности',
        questionsCount: 2,
        difficulty: 'hard'
      }
    }),
    prisma.topic.upsert({
      where: { id: 'civil-3' },
      update: {},
      create: {
        id: 'civil-3',
        subjectId: subjects[1].id,
        title: 'Обязательственное право',
        description: 'Понятие, виды и исполнение обязательств',
        questionsCount: 1,
        difficulty: 'hard'
      }
    })
  ]);

  console.log('✅ Темы гражданского права созданы');

  console.log('🎉 База данных успешно заполнена!');
  console.log(`📊 Создано:`);
  console.log(`   - ${subjects.length} предметов`);
  console.log(`   - ${constitutionalTopics.length + civilTopics.length} тем`);
  console.log(`   - ${questions.length} вопросов`);
}

main()
  .catch((e) => {
    console.error('❌ Ошибка при заполнении базы данных:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

