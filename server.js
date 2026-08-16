// =======================================
// ARIF VISA AUTO FILL PRO
// API SERVER v7.0
// SMART PASSPORT OCR
// MRZ PRIMARY + VISUAL FIELD EXTRACTION
// =======================================

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const sharp = require("sharp");
const { createWorker } = require("tesseract.js");

const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 15 * 1024 * 1024
    }
});


// =======================================
// STATUS
// =======================================

app.get("/", (req, res) => {

    res.json({
        status: "ARIF VISA API RUNNING",
        version: "7.0.0",
        ocr: "READY",
        mode: "MRZ PRIMARY + SMART VISUAL OCR"
    });

});


// =======================================
// BASIC CLEAN
// =======================================

function cleanText(text) {

    return String(text || "")
        .replace(/\r/g, "\n")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\t/g, " ")
        .replace(/[ ]{2,}/g, " ")
        .replace(/\n[ ]+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

}


function normalizeSpaces(value) {

    return String(value || "")
        .replace(/\s+/g, " ")
        .trim();

}


// =======================================
// REMOVE OCR GARBAGE
// =======================================

function cleanField(value) {

    if (!value) return "";

    let v = normalizeSpaces(value);

    v = v
        .replace(/[|]/g, "I")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .trim();

    // Remove trailing OCR garbage
    v = v.replace(/\s+[—–\-_=]+\s*$/g, "");
    v = v.replace(/\s+[—–]+\s*[A-Z]$/g, "");

    return v.trim();

}


// =======================================
// VALIDATE REAL NAME
// =======================================

function cleanName(value) {

    if (!value) return "";

    let v = String(value)
        .replace(/[^A-Za-z .'-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

    // Never allow huge MRZ filler to become a name
    if (
        v.length > 45 ||
        /L{8,}/i.test(v) ||
        /<{5,}/.test(v)
    ) {
        return "";
    }

    return v;

}


// =======================================
// VALIDATE PERSON NAME
// =======================================

function validPersonName(value) {

    const v = cleanName(value);

    if (!v) return false;

    if (v.length < 2) return false;

    if (/^(NAME|FATHER|MOTHER|SPOUSE|HUSBAND|WIFE)$/i.test(v)) {
        return false;
    }

    if (/L{6,}/i.test(v)) {
        return false;
    }

    return true;

}


// =======================================
// GET LINES
// =======================================

function getLines(text) {

    return cleanText(text)
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);

}


// =======================================
// FIELD AFTER LABEL
// IMPORTANT:
// ONLY ACCEPT SAME LINE OR IMMEDIATE NEXT LINE
// =======================================

function findVisualField(text, labels, options = {}) {

    const lines = getLines(text);

    const maxNextLines =
        options.maxNextLines === undefined
            ? 1
            : options.maxNextLines;

    for (let i = 0; i < lines.length; i++) {

        const line = lines[i];

        for (const label of labels) {

            const escaped =
                label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

            const sameLine =
                new RegExp(
                    "^\\s*" +
                    escaped +
                    "\\s*[:\\-]?\\s*(.*?)\\s*$",
                    "i"
                );

            const match =
                line.match(sameLine);

            if (match) {

                let value =
                    cleanField(match[1]);

                if (value && !looksLikeAnotherLabel(value)) {
                    return value;
                }

                for (
                    let j = 1;
                    j <= maxNextLines;
                    j++
                ) {

                    if (!lines[i + j]) continue;

                    const next =
                        cleanField(lines[i + j]);

                    if (
                        next &&
                        !looksLikeAnotherLabel(next)
                    ) {

                        return next;

                    }

                }

            }

        }

    }

    return "";

}


// =======================================
// LABEL DETECTOR
// =======================================

function looksLikeAnotherLabel(value) {

    if (!value) return true;

    const v =
        String(value)
            .trim()
            .toUpperCase();

    const labels = [

        "NAME",
        "FATHER",
        "FATHER'S NAME",
        "MOTHER",
        "MOTHER'S NAME",
        "SPOUSE",
        "SPOUSE'S NAME",
        "PERMANENT ADDRESS",
        "ADDRESS",
        "EMERGENCY CONTACT",
        "RELATIONSHIP",
        "TELEPHONE NO",
        "SURNAME",
        "GIVEN NAME",
        "GIVEN NAMES",
        "PASSPORT NUMBER",
        "NATIONALITY",
        "DATE OF BIRTH",
        "DATE OF ISSUE",
        "DATE OF EXPIRY",
        "SEX",
        "PLACE OF BIRTH",
        "PLACE OF ISSUE",
        "ISSUING AUTHORITY",
        "PERSONAL NO",
        "PREVIOUS PASSPORT NO",
        "PROFESSION",
        "OCCUPATION"

    ];

    return labels.some(label =>
        v === label ||
        v.startsWith(label + " ")
    );

}


// =======================================
// FIND MRZ
// =======================================

function findMRZ(text) {

    const lines =
        getLines(text)
            .map(line =>
                line
                    .replace(/\s/g, "")
                    .toUpperCase()
            );

    const candidates =
        lines.filter(line => {

            if (line.length < 35) {
                return false;
            }

            return /^[A-Z0-9<]+$/.test(line);

        });

    // Prefer real TD3 passport MRZ
    const exact44 =
        candidates.filter(
            line => line.length >= 40
        );

    if (exact44.length >= 2) {

        return exact44.slice(-2);

    }

    return candidates.slice(-2);

}


// =======================================
// MRZ CHARACTER NORMALIZATION
// =======================================

function normalizeMRZ(line) {

    if (!line) return "";

    let v =
        line
            .replace(/\s/g, "")
            .toUpperCase();

    // Common OCR errors
    v = v
        .replace(/«/g, "<")
        .replace(/‹/g, "<")
        .replace(/>/g, "<");

    return v;

}


// =======================================
// MRZ LINE 1
// TD3:
//
// P<BGD
// HOSSEN
// <<
// MD<ABUL
//
// =======================================

function parseMRZLine1(line) {

    line = normalizeMRZ(line);

    if (!line.startsWith("P<")) {

        return {
            surname: "",
            givenName: "",
            fullName: ""
        };

    }

    let body =
        line.substring(5);

    body =
        body.replace(/[^A-Z<]/g, "");

    const parts =
        body.split("<<");

    let surname =
        (parts[0] || "")
            .replace(/</g, " ")
            .replace(/\s+/g, " ")
            .trim();

    let givenName =
        (parts[1] || "")
            .replace(/</g, " ")
            .replace(/\s+/g, " ")
            .trim();

    // Remove MRZ filler
    surname =
        surname
            .replace(/\bL{5,}\b/gi, "")
            .trim();

    givenName =
        givenName
            .replace(/\bL{5,}\b/gi, "")
            .trim();

    // Sometimes OCR converts < to letters.
    // Never accept massive filler.
    if (surname.length > 30) {
        surname = surname.split(" ")[0] || "";
    }

    if (givenName.length > 35) {
        givenName =
            givenName
                .split(" ")
                .slice(0, 4)
                .join(" ");
    }

    surname =
        cleanName(surname);

    givenName =
        cleanName(givenName);

    const fullName =
        [givenName, surname]
            .filter(Boolean)
            .join(" ")
            .trim();

    return {
        surname,
        givenName,
        fullName
    };

}


// =======================================
// MRZ DATE
// YYMMDD
// =======================================

function mrzDateToISO(value, type) {

    if (!value) return "";

    let v =
        String(value)
            .replace(/O/g, "0")
            .replace(/Q/g, "0")
            .replace(/I/g, "1")
            .replace(/L/g, "1")
            .replace(/S/g, "5")
            .replace(/Z/g, "2")
            .replace(/B/g, "8");

    if (!/^\d{6}$/.test(v)) {
        return "";
    }

    const yy =
        parseInt(v.substring(0, 2), 10);

    const mm =
        parseInt(v.substring(2, 4), 10);

    const dd =
        parseInt(v.substring(4, 6), 10);

    if (
        mm < 1 ||
        mm > 12 ||
        dd < 1 ||
        dd > 31
    ) {
        return "";
    }

    let year;

    if (type === "dob") {

        // Passport DOB:
        // 00-26 => 2000-2026
        // 27-99 => 1927-1999
        year =
            yy <= 26
                ? 2000 + yy
                : 1900 + yy;

    } else {

        // Expiry dates are normally future dates
        year =
            yy <= 60
                ? 2000 + yy
                : 1900 + yy;

    }

    const date =
        new Date(
            Date.UTC(year, mm - 1, dd)
        );

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== mm - 1 ||
        date.getUTCDate() !== dd
    ) {

        return "";

    }

    return (
        String(year).padStart(4, "0") +
        "-" +
        String(mm).padStart(2, "0") +
        "-" +
        String(dd).padStart(2, "0")
    );

}


// =======================================
// MRZ LINE 2
//
// Passport no: 0-8
// check:       9
// nationality: 10-12
// DOB:         13-18
// check:       19
// sex:         20
// expiry:      21-26
// =======================================

function parseMRZLine2(line) {

    line =
        normalizeMRZ(line);

    // OCR may turn first zero into O
    if (
        line.length >= 9 &&
        /^[A-Z]O/.test(line)
    ) {

        line =
            line[0] +
            "0" +
            line.substring(2);

    }

    const result = {

        passportNo: "",
        nationality: "",
        dob: "",
        sex: "",
        expiryDate: ""

    };

    if (line.length < 27) {

        return result;

    }

    let passportNo =
        line
            .substring(0, 9)
            .replace(/</g, "")
            .replace(/O/g, "0")
            .toUpperCase();

    // Bangladesh passport normally A + 8 digits
    if (
        /^[A-Z]\d{8}$/.test(passportNo)
    ) {

        result.passportNo =
            passportNo;

    } else {

        // Try OCR correction
        passportNo =
            passportNo
                .replace(/I/g, "1")
                .replace(/L/g, "1")
                .replace(/O/g, "0");

        if (
            /^[A-Z]\d{8}$/.test(passportNo)
        ) {

            result.passportNo =
                passportNo;

        }

    }


    let nationality =
        line
            .substring(10, 13)
            .replace(/</g, "")
            .toUpperCase();

    if (nationality === "BGD") {

        result.nationality = "BGD";

    }


    const dobRaw =
        line.substring(13, 19);

    result.dob =
        mrzDateToISO(
            dobRaw,
            "dob"
        );


    const sex =
        line
            .substring(20, 21)
            .toUpperCase();

    if (
        sex === "M" ||
        sex === "F"
    ) {

        result.sex = sex;

    }


    const expiryRaw =
        line.substring(21, 27);

    result.expiryDate =
        mrzDateToISO(
            expiryRaw,
            "expiry"
        );

    return result;

}


// =======================================
// PARSE MRZ
// =======================================

function parseMRZ(lines) {

    if (!lines || lines.length < 2) {

        return {

            passportNo: "",
            nationality: "",
            dob: "",
            sex: "",
            expiryDate: "",
            surname: "",
            givenName: "",
            fullName: ""

        };

    }

    let line1 = "";
    let line2 = "";

    for (let i = 0; i < lines.length; i++) {

        const line =
            normalizeMRZ(lines[i]);

        if (
            line.startsWith("P<") &&
            line.length >= 30
        ) {

            line1 = line;

            if (lines[i + 1]) {

                line2 =
                    normalizeMRZ(lines[i + 1]);

            }

            break;

        }

    }

    if (!line1) {

        line1 = normalizeMRZ(lines[0]);
        line2 = normalizeMRZ(lines[1]);

    }

    const name =
        parseMRZLine1(line1);

    const details =
        parseMRZLine2(line2);

    return {

        ...details,
        ...name

    };

}


// =======================================
// PASSPORT NUMBER FROM VISUAL OCR
// =======================================

function findVisualPassportNumber(text) {

    const patterns = [

        /PASSPORT\s*(?:NO|NUMBER)\s*[:\-]?\s*([A-Z][A-Z0-9]{7,9})/i,

        /PASSPORT\s*NUMBER\s+([A-Z][A-Z0-9]{7,9})/i,

        /\b([A-Z]\d{8})\b/

    ];

    for (const pattern of patterns) {

        const match =
            text.match(pattern);

        if (!match) continue;

        let value =
            match[1]
                .toUpperCase()
                .replace(/O/g, "0")
                .replace(/I/g, "1")
                .replace(/L/g, "1");

        if (/^[A-Z]\d{8}$/.test(value)) {

            return value;

        }

    }

    return "";

}


// =======================================
// VISUAL DATE PARSER
// =======================================

function normalizeVisualDate(value) {

    if (!value) return "";

    let v =
        String(value)
            .toUpperCase()
            .replace(/,/g, " ")
            .replace(/\s+/g, " ")
            .trim();

    const months = {

        JAN: "01",
        JANUARY: "01",

        FEB: "02",
        FEBRUARY: "02",

        MAR: "03",
        MARCH: "03",

        APR: "04",
        APRIL: "04",

        MAY: "05",

        JUN: "06",
        JUNE: "06",

        JUL: "07",
        JULY: "07",

        AUG: "08",
        AUGUST: "08",

        SEP: "09",
        SEPT: "09",
        SEPTEMBER: "09",

        OCT: "10",
        OCTOBER: "10",

        NOV: "11",
        NOVEMBER: "11",

        DEC: "12",
        DECEMBER: "12"

    };

    let m;

    // 04 OCT 1983
    m =
        v.match(
            /^(\d{1,2})\s+([A-Z]+)\s+(\d{4})$/
        );

    if (m && months[m[2]]) {

        const day =
            String(m[1]).padStart(2, "0");

        return `${m[3]}-${months[m[2]]}-${day}`;

    }


    // OCT 04 1983
    m =
        v.match(
            /^([A-Z]+)\s+(\d{1,2})\s+(\d{4})$/
        );

    if (m && months[m[1]]) {

        const day =
            String(m[2]).padStart(2, "0");

        return `${m[3]}-${months[m[1]]}-${day}`;

    }


    // 04/10/1983
    m =
        v.match(
            /^(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})$/
        );

    if (m) {

        return `${m[3]}-${m[2]}-${m[1]}`;

    }


    return "";

}


// =======================================
// FIND VISUAL DATE
// =======================================

function findVisualDate(text, labels) {

    const value =
        findVisualField(
            text,
            labels,
            {
                maxNextLines: 1
            }
        );

    return normalizeVisualDate(value);

}


// =======================================
// FATHER
// =======================================

function findFather(text) {

    return cleanName(
        findVisualField(
            text,
            [
                "Father's Name",
                "Father's Mame",
                "Father Name",
                "FATHER"
            ]
        )
    );

}


// =======================================
// MOTHER
// =======================================

function findMother(text) {

    return cleanName(
        findVisualField(
            text,
            [
                "Mother's Name",
                "Mother's Mame",
                "Mother Name",
                "MOTHER"
            ]
        )
    );

}


// =======================================
// SPOUSE
// =======================================

function findSpouse(text) {

    const value =
        findVisualField(
            text,
            [
                "Spouse's Name",
                "Spouse's Mame",
                "Spouse Name",
                "SPOUSE"
            ]
        );

    const cleaned =
        cleanName(value);

    if (!validPersonName(cleaned)) {

        return "";

    }

    return cleaned;

}


// =======================================
// ADDRESS
// =======================================

function findAddress(text) {

    const lines =
        getLines(text);

    const labels = [

        "Permanent Address",
        "Permanent Adress",
        "Present Address",
        "Current Address",
        "Residential Address",
        "Address"

    ];

    for (let i = 0; i < lines.length; i++) {

        const line =
            lines[i];

        for (const label of labels) {

            const re =
                new RegExp(
                    "^\\s*" +
                    label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                    "\\s*[:\\-]?\\s*(.*)$",
                    "i"
                );

            const match =
                line.match(re);

            if (!match) continue;

            let value =
                cleanField(match[1]);

            if (value) {

                // remove accidental trailing OCR marks
                value =
                    value
                        .replace(/[—–]+.*$/g, "")
                        .trim();

                return value;

            }

            // Next line only
            if (lines[i + 1]) {

                value =
                    cleanField(lines[i + 1]);

                if (
                    value &&
                    !looksLikeAnotherLabel(value)
                ) {

                    return value;

                }

            }

        }

    }

    return "";

}


// =======================================
// PLACE OF BIRTH
// =======================================

function findPlaceOfBirth(text) {

    return cleanField(
        findVisualField(
            text,
            [
                "Place of Birth",
                "Placeof Birth",
                "Birth Place"
            ]
        )
    );

}


// =======================================
// PLACE OF ISSUE
// =======================================

function findPlaceOfIssue(text) {

    return cleanField(
        findVisualField(
            text,
            [
                "Place of Issue",
                "Placeof Issue",
                "Issuing Place"
            ]
        )
    );

}


// =======================================
// ISSUING AUTHORITY
// =======================================

function findAuthority(text) {

    let value =
        findVisualField(
            text,
            [
                "Issuing Authority",
                "Issuing Authcrity",
                "Authority",
                "Issued By"
            ]
        );

    value =
        cleanField(value);

    // Remove obvious OCR garbage
    value =
        value
            .replace(/[^A-Z0-9 .,'&()\/-]/gi, " ")
            .replace(/\s+/g, " ")
            .trim();

    if (
        value.length > 50 ||
        /PLACE OF|DATE OF|PERSONAL|PREVIOUS/i.test(value)
    ) {

        return "";

    }

    return value;

}


// =======================================
// PERSONAL NUMBER
// =======================================

function findPersonalNumber(text) {

    const patterns = [

        /PERSONAL\s*NO\s*[:\-]?\s*([0-9]{8,20})/i,

        /PERSONAL\s*NUMBER\s*[:\-]?\s*([0-9]{8,20})/i,

        /PERSONAL\s*ID\s*[:\-]?\s*([0-9]{8,20})/i,

        /NATIONAL\s*ID\s*[:\-]?\s*([0-9]{8,20})/i

    ];

    for (const pattern of patterns) {

        const m =
            text.match(pattern);

        if (m && m[1]) {

            return m[1];

        }

    }

    return "";

}


// =======================================
// PREVIOUS PASSPORT
// =======================================

function findPreviousPassport(text) {

    const value =
        findVisualField(
            text,
            [
                "Previous Passport No",
                "Previous Passport",
                "Old Passport No",
                "Old Passport"
            ]
        );

    if (!value) return "";

    const cleaned =
        value
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");

    if (
        /^[A-Z]\d{8}$/.test(cleaned)
    ) {

        return cleaned;

    }

    return "";

}


// =======================================
// PROFESSION
// =======================================

function findProfession(text) {

    const value =
        findVisualField(
            text,
            [
                "Profession",
                "Occupation",
                "Job"
            ]
        );

    if (!value) return "";

    if (
        looksLikeAnotherLabel(value)
    ) {

        return "";

    }

    return cleanField(value);

}


// =======================================
// VISUAL SEX
// =======================================

function findVisualSex(text) {

    const value =
        findVisualField(
            text,
            [
                "Sex",
                "Gender"
            ]
        );

    const v =
        String(value || "")
            .toUpperCase()
            .trim();

    if (
        /^M\b/.test(v) ||
        /^MALE\b/.test(v)
    ) {

        return "M";

    }

    if (
        /^F\b/.test(v) ||
        /^FEMALE\b/.test(v)
    ) {

        return "F";

    }

    return "";

}


// =======================================
// VISUAL NATIONALITY
// =======================================

function findVisualNationality(text) {

    const value =
        findVisualField(
            text,
            [
                "Nationality"
            ]
        );

    const v =
        String(value || "")
            .toUpperCase();

    if (
        v.includes("BANGLADESH") ||
        v.includes("BANGLADESHI") ||
        /\bBGD\b/.test(v)
    ) {

        return "BGD";

    }

    return "";

}


// =======================================
// VISUAL NAME
// =======================================

function findVisualSurname(text) {

    const value =
        findVisualField(
            text,
            [
                "Surname",
                "Sur name",
                "Family Name",
                "Last Name"
            ]
        );

    return cleanName(value);

}


function findVisualGivenName(text) {

    const value =
        findVisualField(
            text,
            [
                "Given Name",
                "Given Names",
                "Given Mame",
                "First Name"
            ]
        );

    return cleanName(value);

}


// =======================================
// OCR
// =======================================

async function runOCR(buffer) {

    console.log("OCR START");

    const processed =
        await sharp(buffer)
            .rotate()
            .resize({
                width: 2600,
                withoutEnlargement: false
            })
            .grayscale()
            .normalize()
            .sharpen()
            .png()
            .toBuffer();

    const worker =
        await createWorker("eng");

    await worker.setParameters({

        tessedit_pageseg_mode: "6",

        preserve_interword_spaces: "1"

    });

    const result =
        await worker.recognize(
            processed
        );

    const text =
        result.data.text || "";

    await worker.terminate();

    console.log("OCR DONE");

    console.log(text);

    return text;

}


// =======================================
// READ PASSPORT
// =======================================

app.post(
    "/read-passport",
    upload.single("passport"),
    async (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({

                    success: false,

                    message:
                        "No Passport File"

                });

            }


            console.log(
                "================================="
            );

            console.log(
                "Passport Received:",
                req.file.originalname
            );


            // =================================
            // OCR
            // =================================

            const rawText =
                await runOCR(
                    req.file.buffer
                );

            const text =
                cleanText(rawText);


            // =================================
            // MRZ
            // =================================

            const mrz =
                findMRZ(text);

            console.log(
                "MRZ LINES:",
                mrz
            );


            const mrzData =
                parseMRZ(mrz);

            console.log(
                "MRZ DATA:",
                mrzData
            );


            // =================================
            // VISUAL DATA
            // =================================

            const visualPassportNo =
                findVisualPassportNumber(text);

            const visualSurname =
                findVisualSurname(text);

            const visualGivenName =
                findVisualGivenName(text);

            const visualNationality =
                findVisualNationality(text);

            const visualSex =
                findVisualSex(text);

            const visualDOB =
                findVisualDate(
                    text,
                    [
                        "Date of Birth",
                        "Dateof Birth",
                        "DOB",
                        "Birth Date"
                    ]
                );

            const visualIssue =
                findVisualDate(
                    text,
                    [
                        "Date of Issue",
                        "Dateof Issue",
                        "Issue Date",
                        "Issued"
                    ]
                );

            const visualExpiry =
                findVisualDate(
                    text,
                    [
                        "Date of Expiry",
                        "Dateof Expiry",
                        "Expiry Date",
                        "Expiration Date",
                        "Expiry"
                    ]
                );


            const visualPlaceBirth =
                findPlaceOfBirth(text);

            const visualPlaceIssue =
                findPlaceOfIssue(text);

            const visualAuthority =
                findAuthority(text);

            const personalNo =
                findPersonalNumber(text);

            const previousPassportNo =
                findPreviousPassport(text);

            const address =
                findAddress(text);

            const fatherName =
                findFather(text);

            const motherName =
                findMother(text);

            const spouseName =
                findSpouse(text);

            const profession =
                findProfession(text);


            // =================================
            // FINAL PRIORITY
            // MRZ FIRST FOR CORE PASSPORT DATA
            // =================================

            const finalPassportNo =
                mrzData.passportNo ||
                visualPassportNo ||
                "";

            const finalSurname =
                validPersonName(mrzData.surname)
                    ? mrzData.surname
                    : visualSurname;

            const finalGivenName =
                validPersonName(mrzData.givenName)
                    ? mrzData.givenName
                    : visualGivenName;

            const finalFullName =
                [finalGivenName, finalSurname]
                    .filter(Boolean)
                    .join(" ")
                    .trim();


            const finalNationality =
                mrzData.nationality ||
                visualNationality ||
                "BGD";


            const finalDOB =
                mrzData.dob ||
                visualDOB ||
                "";


            const finalSex =
                mrzData.sex ||
                visualSex ||
                "";


            const finalExpiry =
                mrzData.expiryDate ||
                visualExpiry ||
                "";


            // =================================
            // FINAL DATA
            // =================================

            const data = {

                fullName:
                    finalFullName,

                surname:
                    finalSurname,

                givenName:
                    finalGivenName,

                passportNo:
                    finalPassportNo,

                nationality:
                    finalNationality,

                dob:
                    finalDOB,

                sex:
                    finalSex,

                placeOfBirth:
                    visualPlaceBirth,

                issueDate:
                    visualIssue,

                expiryDate:
                    finalExpiry,

                placeOfIssue:
                    visualPlaceIssue,

                issuingAuthority:
                    visualAuthority,

                personalNo:
                    personalNo,

                previousPassportNo:
                    previousPassportNo,

                address:
                    address,

                fatherName:
                    fatherName,

                motherName:
                    motherName,

                spouseName:
                    spouseName,

                profession:
                    profession,

                mrz:
                    mrz

            };


            // =================================
            // LOG
            // =================================

            console.log(
                "================================="
            );

            console.log(
                "FINAL EXTRACTED DATA:"
            );

            console.log(
                JSON.stringify(
                    data,
                    null,
                    2
                )
            );

            console.log(
                "================================="
            );


            // =================================
            // RESPONSE
            // =================================

            return res.json({

                success: true,

                message:
                    "Smart Passport OCR completed",

                version:
                    "7.0.0",

                mode:
                    "MRZ PRIMARY + SMART NON-MRZ",

                data:
                    data,

                rawText:
                    rawText

            });

        }

        catch (error) {

            console.error(
                "PASSPORT OCR ERROR:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "OCR Failed",

                error:
                    error.message

            });

        }

    }
);


// =======================================
// 404
// =======================================

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            message:
                "API endpoint not found"

        });

    }
);


// =======================================
// SERVER
// =======================================

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `ARIF VISA API SERVER v7.0 RUNNING ON PORT ${PORT}`
        );

    }
);
