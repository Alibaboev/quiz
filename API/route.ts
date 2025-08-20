import { NextRequest, NextResponse } from "next/server";
import parsePhoneNumber from "libphonenumber-js";
import validator from "email-validator";
import { LeadInfo, sendToBitrix, UTMArguments } from "@/integrations/bitrix";
import { sendEmail } from "@/integrations/email"; // Импорт функции для отправки email
import { generateReport } from "@/integrations/gemini"; // Импорт функции для генерации отчета

// --- НОВАЯ ЛОГИКА ДЛЯ МУЛЬТИЯЗЫЧНОСТИ ---

// Функция для динамической загрузки словаря
const getDictionary = async (lang: string) => {
  const supportedLangs = ['ua', 'ru', 'en'];
  const safeLang = supportedLangs.includes(lang) ? lang : 'ua'; // Язык по умолчанию
  try {
    return (await import(`@/data/${safeLang}/questions.json`)).default;
  } catch (error) {
    console.error(`Could not load dictionary for lang: ${safeLang}`, error);
    return (await import(`@/data/ua/questions.json`)).default;
  }
};

// Функция getComment теперь принимает язык и AI-отчет
const getComment = async (answers: { question: string; answer: string; type: string }[], lang: string, aiReportHtml: string) => {
  if (!answers || answers.length === 0) {
    return aiReportHtml || "";
  }

  const dictionary = await getDictionary(lang);
  
  const openAnswersText = answers
    .filter(a => a.type === 'open-ended')
    .map(a => {
        let questionText = a.question;
        // Поиск вопроса в словаре для корректного отображения в CRM
        for (const cohortKey in dictionary) {
            const cohort = dictionary[cohortKey];
            for (const testKey in cohort) {
                const test = cohort[testKey];
                const found = test.find((q: any) => q.question === a.question);
                if (found) {
                    questionText = found.question;
                    break;
                }
            }
        }
        return `${questionText}:\n${a.answer}`;
    })
    .join('\n\n');

  return `--- AI-ОТЧЕТ ---\n${aiReportHtml}\n\n--- ОТВЕТЫ НА ОТКРЫТЫЕ ВОПРОСЫ ---\n${openAnswersText}`;
};

// --- ОСНОВНОЙ ОБРАБОТЧИК ---

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, phone, country, answers, lang, utm } = body;

    // Валидация email (обязательно)
    if (!email || !validator.validate(email)) {
      return NextResponse.json({ message: "Invalid email" }, { status: 400 });
    }

    // Валидация телефона (обязательно, сделать)
    if (phone) {
      const phoneNumber = parsePhoneNumber(phone, country);
      if (!phoneNumber?.isValid()) {
        return NextResponse.json({ message: "Invalid phone number" }, { status: 400 });
      }
    }

    // --- ИНТЕГРАЦИЯ С GEMINI ---
    // Генерируем отчет ПЕРЕД отправкой данных
    const aiReportHtml = await generateReport({ answers, lang, userRole: body.userRole, educationLevel: body.educationLevel });

    if (!aiReportHtml) {
        // Если Gemini не ответил, отправляем ошибку
        return NextResponse.json({ message: "Failed to generate AI report." }, { status: 500 });
    }

    // --- ИНТЕГРАЦИЯ С BITRIX24 ---
    const title = answers ? `AI Квиз - ${name}` : `Лендинг - ${name}`;
    const comment = await getComment(answers, lang, aiReportHtml);

    const bitrixInfo: LeadInfo = {
      email: email,
      name: name,
      phone: phone || "",
      comment: comment,
    };

    const utmInfo: UTMArguments = utm;

    await sendToBitrix(title, bitrixInfo, utmInfo);
    
    // --- ИНТЕГРАЦИЯ С SENDGRID/RESEND ---
    await sendEmail({
        to: email,
        subject: "Ваши персональные результаты теста по профориентации",
        html: aiReportHtml,
    });

    return NextResponse.json({ message: "DONE" });

  } catch (error) {
    console.error("API Lead Error:", error);
    return NextResponse.json({ message: "An internal server error occurred." }, { status: 500 });
  }
}
