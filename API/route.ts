import {NextRequest, NextResponse} from "next/server";
import parsePhoneNumber from "libphonenumber-js"
import validator from "email-validator"
import {LeadInfo, sendToBitrix, UTMArguments} from "@/integrations/bitrix";
import {orientationUAText} from "@/dictionaries/ua";

const getComment = (answers: {question: any, answer: any}[]) => answers?.reduce((acc, cur) => {
    const questionObject = orientationUAText[cur.question];
    const answer = cur.answer != null ? orientationUAText[cur.question].answers[Number(cur.answer)] : "Не ответил"
    const line = `${questionObject.question}:\n ${answer}\n\n`
    return acc + line;
},"")

export async function POST(request: NextRequest) {
    const body = await request.json();

    console.log("api/lead", body)

    const phoneNumber = parsePhoneNumber(body?.phone, body?.country)
    const numberIsValid = phoneNumber?.isValid();
    const emailIsValid = validator.validate(body?.email);

    const isValid = numberIsValid == true && emailIsValid;
    if(isValid) {
        const title = body.answers? "Orientation - Medstudy" : "Landing - Medstudy"

        const bitrixInfo: LeadInfo = {
            email: body?.email,
            name: body?.name,
            phone: body?.phone,
            comment: getComment(body?.answers) || ""
        };
        const utmInfo: UTMArguments = body?.utm

        console.log("Title: ", title);
        console.log("Bitrix info: ", bitrixInfo);
        console.log("utm: ", utmInfo);

        await sendToBitrix(title, bitrixInfo, utmInfo);
        return NextResponse.json({ "message": "DONE" });
    } else {
        console.log("PhoneNumber validation: " + numberIsValid)
        console.log("Email validation: " + emailIsValid)
        return NextResponse.json({ "message": "Validation error. Please check that your information is correct" }, { status: 401 });
    }
}