// =======================================
// ARIF VISA AUTO FILL PRO
// API SERVER v7.1
// PRINTED PASSPORT FIRST
// MRZ BACKUP ONLY
// =======================================

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const sharp = require("sharp");
const { createWorker } = require("tesseract.js");

const app = express();

app.use(cors());
app.use(express.json());


// =======================================
// UPLOAD
// =======================================

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
        version: "7.1.0",
        ocr: "READY",
        mode: "PRINTED PASSPORT FIRST - MRZ BACKUP"
    });

});


// =======================================
// BASIC TEXT CLEAN
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


function normalize(value) {

    if (!value) return "";

    return String(value)
        .replace(/[|]/g, "I")
        .replace(/\s+/g, " ")
        .trim();

}


function cleanField(value) {

    let v = normalize(value);

    if (!v) return "";

    v = v
        .replace(/^[\s:;,\-—–]+/, "")
        .replace(/[\s—–]+$/, "")
        .trim();

    if (!v) return "";

    if (/^[-—–_=]+$/.test(v)) {
        return "";
    }

    return v;

}


// =======================================
// NAME CLEANER
// =======================================

function cleanName(value) {

    let v = cleanField(value);

    if (!v) return "";

    v = v
        .replace(/[^A-Za-z .'-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

    // MRZ garbage protection
    if (/L{7,}/i.test(v)) {
        return "";
    }

    if (v.length > 60) {
        return "";
    }

    if (
        /^(NAME|SURNAME|GIVEN NAME|GIVEN NAMES|FATHER|MOTHER|SPOUSE)$/i
            .test(v)
    ) {
        return "";
    }

    return v;

}


function validName(value) {

    const v = cleanName(value);

    if (!v) return "";

    if (v.length < 2) return "";

    return v;

}


// =======================================
// OCR LINES
// =======================================

function getLines(text) {

    return cleanText(text)
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);

}


// =======================================
// FIELD LABELS
// =======================================

const FIELD_LABELS = [

    "Surname",
    "Given Name",
    "Given Names",
    "Passport Number",
    "Passport No",
    "Nationality",
    "Personal No",
    "Date of Birth",
    "Date of Issue",
    "Date of Expiry",
    "Sex",
    "Place of Birth",
    "Place of Issue",
    "Issuing Authority",
    "Previous Passport No",
    "Father's Name",
    "Father’s Name",
    "Father Name",
    "Mother's Name",
    "Mother’s Name",
    "Mother Name",
    "Spouse's Name",
    "Spouse’s Name",
    "Spouse Name",
    "Permanent Address",
    "Present Address",
    "Current Address",
    "Residential Address",
    "Address",
    "Profession",
    "Occupation"
];


// =======================================
// ESCAPE REGEX
// =======================================

function escapeRegex(value) {

    return String(value)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

}


// =======================================
// FIND LABEL VALUE
// SAME LINE + NEXT LINE
// DOES NOT JUMP RANDOMLY
// =======================================

function findLabelValue(text, labels) {

    const lines = getLines(text);

    for (let i = 0; i < lines.length; i++) {

        const line = lines[i];

        for (const label of labels) {

            const regex = new RegExp(
                "(?:^|\\s)" +
                escapeRegex(label) +
                "\\s*[:.\\-]?\\s*(.*)$",
                "i"
            );

            const match = line.match(regex);

            if (match) {

                let value =
                    cleanField(match[1] || "");

                // Remove another field accidentally captured
                value = removeNextLabel(value);

                if (value) {
                    return value;
                }


                // Next line
                if (lines[i + 1]) {

                    const next =
                        cleanField(lines[i + 1]);

                    if (
                        next &&
                        !isLabelLine(next)
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
// REMOVE NEXT FIELD LABEL
// =======================================

function removeNextLabel(value) {

    let result =
        String(value || "");

    for (const label of FIELD_LABELS) {

        const regex =
            new RegExp(
                "\\s+" +
                escapeRegex(label) +
                "\\b.*$",
                "i"
            );

        result =
            result.replace(regex, "");

    }

    return cleanField(result);

}


// =======================================
// LABEL LINE CHECK
// =======================================

function isLabelLine(value) {

    const v =
        String(value || "")
            .trim();

    if (!v) return true;

    for (const label of FIELD_LABELS) {

        if (
            new RegExp(
                "^" +
                escapeRegex(label) +
                "\\s*$",
                "i"
            ).test(v)
        ) {

            return true;

        }

    }

    return false;

}


// =======================================
// PASSPORT NUMBER
// PRINTED FIRST
// =======================================

function findPassportNumber(text) {

    const patterns = [

        /Passport\s*Number\s*[:.\-]?\s*([A-Z]\s*\d{8})/i,

        /Passport\s*No\.?\s*[:.\-]?\s*([A-Z]\s*\d{8})/i,

        /Document\s*Number\s*[:.\-]?\s*([A-Z]\s*\d{8})/i

    ];

    for (const pattern of patterns) {

        const match =
            text.match(pattern);

        if (match && match[1]) {

            const value =
                match[1]
                    .replace(/\s/g, "")
                    .toUpperCase();

            if (/^[A-Z]\d{8}$/.test(value)) {

                return value;

            }

        }

    }


    // Generic printed OCR search
    const matches =
        String(text)
            .toUpperCase()
            .match(/\bA\d{8}\b/g);

    if (matches && matches.length) {

        return matches[0];

    }

    return "";

}


// =======================================
// NATIONALITY
// =======================================

function findNationality(text) {

    const value =
        findLabelValue(
            text,
            ["Nationality"]
        );

    const upper =
        String(value || "")
            .toUpperCase();

    if (
        upper.includes("BANGLADESH") ||
        upper.includes("BANGLADESHI") ||
        upper.includes("BGD")
    ) {

        return "BGD";

    }


    // Bangladesh passport fallback
    if (
        /\bPEOPLE'S REPUBLIC OF BANGLADESH\b/i
            .test(text) ||
        /\bBANGLADESH\b/i
            .test(text)
    ) {

        return "BGD";

    }

    return "";

}


// =======================================
// SURNAME
// =======================================

function findSurname(text) {

    return validName(
        findLabelValue(
            text,
            [
                "Surname",
                "Family Name",
                "Last Name"
            ]
        )
    );

}


// =======================================
// GIVEN NAME
// =======================================

function findGivenName(text) {

    return validName(
        findLabelValue(
            text,
            [
                "Given Name",
                "Given Names",
                "First Name"
            ]
        )
    );

}


// =======================================
// FULL NAME
// =======================================

function findFullName(text) {

    const given =
        findGivenName(text);

    const surname =
        findSurname(text);

    if (given && surname) {

        return (
            given +
            " " +
            surname
        ).trim();

    }

    if (given) return given;

    if (surname) return surname;


    // Printed "Name" fallback
    const name =
        findLabelValue(
            text,
            ["Full Name"]
        );

    return validName(name);

}


// =======================================
// FATHER
// =======================================

function findFather(text) {

    return validName(
        findLabelValue(
            text,
            [
                "Father's Name",
                "Father’s Name",
                "Father Name",
                "Father's Mame",
                "Father Mame"
            ]
        )
    );

}


// =======================================
// MOTHER
// =======================================

function findMother(text) {

    return validName(
        findLabelValue(
            text,
            [
                "Mother's Name",
                "Mother’s Name",
                "Mother Name",
                "Mother's Mame",
                "Mother Mame"
            ]
        )
    );

}


// =======================================
// SPOUSE
// =======================================

function findSpouse(text) {

    const value =
        findLabelValue(
            text,
            [
                "Spouse's Name",
                "Spouse’s Name",
                "Spouse Name",
                "Spouse's Mame",
                "Spouse Mame"
            ]
        );

    const cleaned =
        validName(value);

    if (!cleaned) return "";

    // Prevent address being taken as spouse
    if (
        /ADDRESS|LALPUR|NATORE|GOPALPUR|SALAMPUR/i
            .test(cleaned)
    ) {

        return "";

    }

    return cleaned;

}


// =======================================
// DATE MONTHS
// =======================================

const MONTHS = {

    JAN: "01",
    FEB: "02",
    MAR: "03",
    APR: "04",
    MAY: "05",
    JUN: "06",
    JUL: "07",
    AUG: "08",
    SEP: "09",
    OCT: "10",
    NOV: "11",
    DEC: "12"

};


// =======================================
// DATE NORMALIZER
// =======================================

function normalizeDate(value) {

    if (!value) return "";

    let v =
        String(value)
            .toUpperCase()
            .replace(/[|]/g, "I")
            .replace(/\s+/g, " ")
            .trim();

    // OCR corrections only inside date context
    v =
        v.replace(/O/g, "0")
         .replace(/Q/g, "0")
         .replace(/I/g, "1")
         .replace(/L/g, "1")
         .replace(/S/g, "5")
         .replace(/Z/g, "2")
         .replace(/B/g, "8");


    // 04 OCT 1983
    let m =
        v.match(
            /^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/
        );

    if (m) {

        const month =
            MONTHS[m[2]];

        if (month) {

            return (
                m[3] +
                "-" +
                month +
                "-" +
                m[1].padStart(2, "0")
            );

        }

    }


    // 04 OCT 1983 with OCR junk
    m =
        v.match(
            /(\d{1,2})\s+([A-Z]{3})\s+(\d{4})/
        );

    if (m) {

        const month =
            MONTHS[m[2]];

        if (month) {

            return (
                m[3] +
                "-" +
                month +
                "-" +
                m[1].padStart(2, "0")
            );

        }

    }


    // DD/MM/YYYY
    m =
        v.match(
            /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/
        );

    if (m) {

        return (
            m[3] +
            "-" +
            m[2].padStart(2, "0") +
            "-" +
            m[1].padStart(2, "0")
        );

    }


    // YYYY-MM-DD
    m =
        v.match(
            /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/
        );

    if (m) {

        return (
            m[1] +
            "-" +
            m[2].padStart(2, "0") +
            "-" +
            m[3].padStart(2, "0")
        );

    }

    return "";

}


// =======================================
// FIND DATE
// =======================================

function findDate(text, labels) {

    const value =
        findLabelValue(
            text,
            labels
        );

    return normalizeDate(value);

}


// =======================================
// DOB
// =======================================

function findDOB(text) {

    return findDate(
        text,
        [
            "Date of Birth",
            "Dateof Birth",
            "Date Of Birth",
            "DOB",
            "Birth Date"
        ]
    );

}


// =======================================
// ISSUE DATE
// =======================================

function findIssueDate(text) {

    return findDate(
        text,
        [
            "Date of Issue",
            "Dateof Issue",
            "Date Of Issue",
            "Issue Date",
            "Issued"
        ]
    );

}


// =======================================
// EXPIRY
// =======================================

function findExpiryDate(text) {

    return findDate(
        text,
        [
            "Date of Expiry",
            "Dateof Expiry",
            "Date Of Expiry",
            "Expiry Date",
            "Expiration Date",
            "Expiry"
        ]
    );

}


// =======================================
// SEX
// =======================================

function findSex(text) {

    const value =
        findLabelValue(
            text,
            [
                "Sex",
                "Gender"
            ]
        );

    const upper =
        String(value || "")
            .toUpperCase()
            .trim();

    if (
        /^M\b/.test(upper) ||
        /^MALE\b/.test(upper)
    ) {

        return "M";

    }

    if (
        /^F\b/.test(upper) ||
        /^FEMALE\b/.test(upper)
    ) {

        return "F";

    }

    return "";

}


// =======================================
// PLACE OF BIRTH
// =======================================

function findPlaceOfBirth(text) {

    return cleanField(
        findLabelValue(
            text,
            [
                "Place of Birth",
                "Placeof Birth",
                "Place Of Birth",
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
        findLabelValue(
            text,
            [
                "Place of Issue",
                "Placeof Issue",
                "Place Of Issue",
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
        findLabelValue(
            text,
            [
                "Issuing Authority",
                "Issuing Authcrity",
                "Issuing Authority",
                "Authority",
                "Issued By"
            ]
        );

    value =
        cleanField(value);

    if (!value) return "";

    if (
        /DATE OF|PLACE OF|PERSONAL|PREVIOUS/i
            .test(value)
    ) {

        return "";

    }

    if (value.length > 60) {

        return "";

    }

    return value;

}


// =======================================
// PERSONAL NUMBER
// =======================================

function findPersonalNumber(text) {

    const value =
        findLabelValue(
            text,
            [
                "Personal No",
                "Personal No.",
                "Personal Number",
                "Personal ID",
                "National ID",
                "National ID No"
            ]
        );

    if (!value) return "";

    const match =
        value.match(/\d{8,17}/);

    return match
        ? match[0]
        : "";

}


// =======================================
// PREVIOUS PASSPORT
// =======================================

function findPreviousPassport(text) {

    const value =
        findLabelValue(
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
            .replace(/\s/g, "")
            .toUpperCase();

    if (
        /^[A-Z]\d{7,8}$/.test(cleaned)
    ) {

        return cleaned;

    }

    return "";

}


// =======================================
// ADDRESS
// =======================================

function findAddress(text) {

    const value =
        findLabelValue(
            text,
            [
                "Permanent Address",
                "Permanent Adress",
                "Present Address",
                "Current Address",
                "Residential Address",
                "Address"
            ]
        );

    if (!value) return "";

    // Remove emergency contact garbage
    let result =
        value.replace(
            /Emergency Contact.*$/i,
            ""
        );

    result =
        result.replace(
            /\s+[—–]+\s*.*$/,
            ""
        );

    return cleanField(result);

}


// =======================================
// PROFESSION
// =======================================

function findProfession(text) {

    return cleanField(
        findLabelValue(
            text,
            [
                "Profession",
                "Occupation",
                "Job"
            ]
        )
    );

}


// =======================================
// MRZ FINDER
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
        lines.filter(line =>
            /^[A-Z0-9<]+$/.test(line) &&
            line.length >= 30
        );

    // Prefer actual TD3 passport MRZ
    for (let i = 0; i < candidates.length - 1; i++) {

        if (
            candidates[i].startsWith("P<") &&
            candidates[i + 1].length >= 30
        ) {

            return [
                candidates[i],
                candidates[i + 1]
            ];

        }

    }

    return [];

}


// =======================================
// MRZ LINE 1
// ONLY BACKUP
// =======================================

function parseMRZLine1(line) {

    if (!line) {

        return {
            surname: "",
            givenName: ""
        };

    }

    line =
        line
            .replace(/\s/g, "")
            .toUpperCase();

    if (!line.startsWith("P<")) {

        return {
            surname: "",
            givenName: ""
        };

    }

    // P<BGDHOSSEN<K<MD<ABUL
    let body =
        line.substring(5);

    body =
        body.replace(
            /[^A-Z<]/g,
            ""
        );

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

    // Remove filler
    surname =
        surname
            .replace(/L{5,}/gi, "")
            .trim();

    givenName =
        givenName
            .replace(/L{5,}/gi, "")
            .trim();

    return {

        surname:
            cleanName(surname),

        givenName:
            cleanName(givenName)

    };

}


// =======================================
// MRZ LINE 2
// BACKUP ONLY
// =======================================

function parseMRZLine2(line) {

    const result = {

        passportNo: "",
        nationality: "",
        dob: "",
        sex: "",
        expiryDate: ""

    };

    if (!line) return result;

    line =
        line
            .replace(/\s/g, "")
            .toUpperCase();

    if (line.length < 27) {

        return result;

    }

    // Passport number
    let passportNo =
        line
            .substring(0, 9)
            .replace(/</g, "")
            .replace(/O/g, "0");

    if (
        /^[A-Z]\d{8}$/.test(passportNo)
    ) {

        result.passportNo =
            passportNo;

    }


    // Nationality
    const nationality =
        line.substring(10, 13);

    if (
        nationality === "BGD"
    ) {

        result.nationality =
            "BGD";

    }


    // DOB
    const dob =
        line.substring(13, 19);

    if (/^\d{6}$/.test(dob)) {

        const yy =
            parseInt(
                dob.substring(0, 2),
                10
            );

        const mm =
            dob.substring(2, 4);

        const dd =
            dob.substring(4, 6);

        let year =
            yy <= 26
                ? 2000 + yy
                : 1900 + yy;

        if (
            Number(mm) >= 1 &&
            Number(mm) <= 12 &&
            Number(dd) >= 1 &&
            Number(dd) <= 31
        ) {

            result.dob =
                `${year}-${mm}-${dd}`;

        }

    }


    // Sex
    const sex =
        line.substring(20, 21);

    if (
        sex === "M" ||
        sex === "F"
    ) {

        result.sex = sex;

    }


    // Expiry
    const expiry =
        line.substring(21, 27);

    if (/^\d{6}$/.test(expiry)) {

        const yy =
            parseInt(
                expiry.substring(0, 2),
                10
            );

        const mm =
            expiry.substring(2, 4);

        const dd =
            expiry.substring(4, 6);

        let year =
            yy <= 60
                ? 2000 + yy
                : 1900 + yy;

        if (
            Number(mm) >= 1 &&
            Number(mm) <= 12 &&
            Number(dd) >= 1 &&
            Number(dd) <= 31
        ) {

            result.expiryDate =
                `${year}-${mm}-${dd}`;

        }

    }

    return result;

}


// =======================================
// PARSE MRZ
// =======================================

function parseMRZ(lines) {

    if (
        !lines ||
        lines.length < 2
    ) {

        return {

            passportNo: "",
            nationality: "",
            dob: "",
            sex: "",
            expiryDate: "",
            surname: "",
            givenName: ""

        };

    }

    const line1 =
        lines.find(x =>
            x.startsWith("P<")
        ) || "";

    const line2 =
        lines.find(x =>
            !x.startsWith("P<") &&
            x.length >= 30
        ) || "";

    const name =
        parseMRZLine1(line1);

    const core =
        parseMRZLine2(line2);

    return {

        ...core,

        surname:
            name.surname,

        givenName:
            name.givenName

    };

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
                width: 2800,
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
            // VISUAL / PRINTED DATA
            // =================================

            const visualPassportNo =
                findPassportNumber(text);

            const visualNationality =
                findNationality(text);

            const visualSurname =
                findSurname(text);

            const visualGivenName =
                findGivenName(text);

            const visualFullName =
                findFullName(text);

            const visualFather =
                findFather(text);

            const visualMother =
                findMother(text);

            const visualSpouse =
                findSpouse(text);

            const visualDOB =
                findDOB(text);

            const visualSex =
                findSex(text);

            const visualBirthPlace =
                findPlaceOfBirth(text);

            const visualIssue =
                findIssueDate(text);

            const visualExpiry =
                findExpiryDate(text);

            const visualPlaceIssue =
                findPlaceOfIssue(text);

            const visualAuthority =
                findAuthority(text);

            const visualPersonalNo =
                findPersonalNumber(text);

            const visualPrevious =
                findPreviousPassport(text);

            const visualAddress =
                findAddress(text);

            const visualProfession =
                findProfession(text);


            // =================================
            // MRZ
            // BACKUP ONLY
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
            // FINAL PRIORITY
            //
            // PRINTED DATA FIRST
            // MRZ ONLY IF PRINTED DATA MISSING
            // =================================

            const finalPassportNo =
                visualPassportNo ||
                mrzData.passportNo ||
                "";

            const finalSurname =
                visualSurname ||
                mrzData.surname ||
                "";

            const finalGivenName =
                visualGivenName ||
                mrzData.givenName ||
                "";

            const finalFullName =
                visualFullName ||
                [finalGivenName, finalSurname]
                    .filter(Boolean)
                    .join(" ")
                    .trim();

            const finalNationality =
                visualNationality ||
                mrzData.nationality ||
                "";

            const finalDOB =
                visualDOB ||
                mrzData.dob ||
                "";

            const finalSex =
                visualSex ||
                mrzData.sex ||
                "";

            const finalExpiry =
                visualExpiry ||
                mrzData.expiryDate ||
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
                    visualBirthPlace,

                issueDate:
                    visualIssue,

                expiryDate:
                    finalExpiry,

                placeOfIssue:
                    visualPlaceIssue,

                issuingAuthority:
                    visualAuthority,

                personalNo:
                    visualPersonalNo,

                previousPassportNo:
                    visualPrevious,

                address:
                    visualAddress,

                fatherName:
                    visualFather,

                motherName:
                    visualMother,

                spouseName:
                    visualSpouse,

                profession:
                    visualProfession,

                mrz:
                    mrz

            };


            console.log(
                "================================="
            );

            console.log(
                "FULL EXTRACTED DATA:"
            );

            console.log(
                JSON.stringify(
                    data,
                    null,
                    2
                )
            );


            // =================================
            // RESPONSE
            // =================================

            return res.json({

                success: true,

                message:
                    "Passport extraction completed",

                version:
                    "7.1.0",

                mode:
                    "PRINTED PASSPORT FIRST - MRZ BACKUP",

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
// SERVER
// =======================================

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `ARIF VISA API SERVER v7.1 RUNNING ON PORT ${PORT}`
        );

    }
);
