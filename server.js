// =======================================
// ARIF VISA AUTO FILL PRO
// API SERVER v5.0
// FULL PASSPORT OCR
// MRZ + NON-MRZ
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
// API STATUS
// =======================================

app.get("/", (req, res) => {

    res.json({
        status: "ARIF VISA API RUNNING",
        version: "5.0.0",
        ocr: "READY",
        mode: "FULL PASSPORT OCR - MRZ + NON-MRZ"
    });

});


// =======================================
// CLEAN OCR TEXT
// =======================================

function cleanText(text) {

    return (text || "")
        .replace(/\r/g, "\n")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\t/g, " ")
        .replace(/[ ]{2,}/g, " ")
        .replace(/\n[ ]+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

}


// =======================================
// NORMALIZE
// =======================================

function normalize(value) {

    if (!value) return "";

    return String(value)
        .replace(/[|]/g, "I")
        .replace(/\s+/g, " ")
        .trim();

}


// =======================================
// SAFE UPPER
// =======================================

function upper(value) {

    return normalize(value).toUpperCase();

}


// =======================================
// GET LINES
// =======================================

function getLines(text) {

    return cleanText(text)
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

}


// =======================================
// GET VALUE AFTER LABEL
// =======================================

function findAfterLabel(text, labels) {

    const lines = getLines(text);

    for (let i = 0; i < lines.length; i++) {

        const originalLine = lines[i];

        const line = originalLine
            .replace(/\s+/g, " ")
            .trim();

        for (const label of labels) {

            const escaped =
                label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

            const regex = new RegExp(
                "^" +
                escaped +
                "\\s*(?::|\\-|=)?\\s*(.*)$",
                "i"
            );

            const match = line.match(regex);

            if (match) {

                let value =
                    (match[1] || "").trim();

                if (!value && lines[i + 1]) {

                    value =
                        lines[i + 1].trim();

                }

                if (value) {

                    return normalize(value);

                }

            }

        }

    }

    return "";

}


// =======================================
// FIND FIELD BY FLEXIBLE LABEL
// =======================================

function findFlexibleLabel(text, labels) {

    const lines = getLines(text);

    for (let i = 0; i < lines.length; i++) {

        const line =
            lines[i]
                .replace(/[^A-Z0-9' ]/gi, " ")
                .replace(/\s+/g, " ")
                .trim()
                .toUpperCase();

        for (const label of labels) {

            const cleanLabel =
                label
                    .replace(/[^A-Z0-9]/gi, "")
                    .toUpperCase();

            const cleanLine =
                line
                    .replace(/[^A-Z0-9]/g, "");

            if (
                cleanLine === cleanLabel ||
                cleanLine.startsWith(cleanLabel)
            ) {

                let value =
                    lines[i]
                        .replace(
                            new RegExp(
                                label,
                                "i"
                            ),
                            ""
                        )
                        .replace(
                            /^[:\-\s]+/,
                            ""
                        )
                        .trim();

                if (!value && lines[i + 1]) {

                    value =
                        lines[i + 1].trim();

                }

                if (value) {

                    return normalize(value);

                }

            }

        }

    }

    return "";

}


// =======================================
// PASSPORT NUMBER
// =======================================

function findPassportNumber(text) {

    const patterns = [

        /PASSPORT\s*(?:NO|NUMBER)?\s*[:\-]?\s*([A-Z][A-Z0-9]{6,9})/i,

        /PASSPORT\s*#\s*([A-Z][A-Z0-9]{6,9})/i,

        /DOCUMENT\s*(?:NO|NUMBER)?\s*[:\-]?\s*([A-Z][A-Z0-9]{6,9})/i,

        /\b([A-Z][0-9]{7,8})\b/i

    ];

    for (const pattern of patterns) {

        const match =
            text.match(pattern);

        if (
            match &&
            match[1]
        ) {

            return match[1]
                .replace(/[\s<]/g, "")
                .toUpperCase();

        }

    }

    return "";

}


// =======================================
// DATE NORMALIZER
// =======================================

function normalizeDate(value) {

    if (!value) return "";

    value = String(value)
        .toUpperCase()
        .replace(/[OQ]/g, "0")
        .replace(/[IL]/g, "1")
        .replace(/[SZ]/g, "5")
        .replace(/[B]/g, "8")
        .replace(/\s/g, "")
        .trim();

    let m;

    m = value.match(
        /^(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})$/
    );

    if (m) {

        return `${m[3]}-${m[2]}-${m[1]}`;

    }

    m = value.match(
        /^(\d{4})[\/.\-](\d{2})[\/.\-](\d{2})$/
    );

    if (m) {

        return `${m[1]}-${m[2]}-${m[3]}`;

    }

    m = value.match(
        /^(\d{2})(\d{2})(\d{4})$/
    );

    if (m) {

        return `${m[3]}-${m[2]}-${m[1]}`;

    }

    return "";

}


// =======================================
// MRZ DATE
// YYMMDD -> YYYY-MM-DD
// =======================================

function mrzDate(value, type = "dob") {

    if (!value) return "";

    value =
        value
            .replace(/[^0-9]/g, "")
            .trim();

    if (!/^\d{6}$/.test(value)) {

        return "";

    }

    const yy =
        parseInt(value.substring(0, 2), 10);

    const mm =
        value.substring(2, 4);

    const dd =
        value.substring(4, 6);

    if (
        Number(mm) < 1 ||
        Number(mm) > 12 ||
        Number(dd) < 1 ||
        Number(dd) > 31
    ) {

        return "";

    }

    let year;

    if (type === "dob") {

        year =
            yy >= 30
                ? 1900 + yy
                : 2000 + yy;

    }
    else {

        year =
            yy >= 70
                ? 1900 + yy
                : 2000 + yy;

    }

    return `${year}-${mm}-${dd}`;

}


// =======================================
// DOB
// =======================================

function findDOB(text) {

    const value =
        findAfterLabel(text, [
            "DATE OF BIRTH",
            "DATEOF BIRTH",
            "DATE OF BIRTH.",
            "DOB",
            "BIRTH DATE",
            "BIRTHDATE"
        ]);

    return normalizeDate(value);

}


// =======================================
// ISSUE DATE
// =======================================

function findIssueDate(text) {

    const value =
        findAfterLabel(text, [
            "DATE OF ISSUE",
            "DATEOF ISSUE",
            "ISSUE DATE",
            "DATE ISSUED",
            "ISSUED"
        ]);

    return normalizeDate(value);

}


// =======================================
// EXPIRY DATE
// =======================================

function findExpiry(text) {

    const value =
        findAfterLabel(text, [
            "DATE OF EXPIRY",
            "DATEOF EXPIRY",
            "EXPIRY DATE",
            "EXPIRATION DATE",
            "EXPIRY",
            "DATE OF EXPIRATION"
        ]);

    return normalizeDate(value);

}


// =======================================
// NATIONALITY
// =======================================

function findNationality(text) {

    const value =
        findAfterLabel(text, [
            "NATIONALITY"
        ]);

    if (value) {

        const v =
            upper(value);

        if (
            v.includes("BANGLADESH") ||
            /\bBGD\b/.test(v)
        ) {

            return "BGD";

        }

        const match =
            v.match(/\b[A-Z]{3}\b/);

        if (match) {

            return match[0];

        }

    }

    const all =
        upper(text);

    if (
        all.includes("BANGLADESH") ||
        /\bBGD\b/.test(all)
    ) {

        return "BGD";

    }

    return "";

}


// =======================================
// SEX
// =======================================

function findSex(text) {

    const value =
        findAfterLabel(text, [
            "SEX",
            "GENDER"
        ]);

    if (!value) {

        return "";

    }

    const v =
        upper(value);

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
// CLEAN PERSON NAME
// =======================================

function cleanPersonName(value) {

    return String(value || "")
        .replace(/[^A-Z .'-]/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

}


// =======================================
// FULL NAME
// =======================================

function findName(text) {

    let value =
        findAfterLabel(text, [
            "FULL NAME",
            "NAME"
        ]);

    if (!value) {

        value =
            findAfterLabel(text, [
                "GIVEN NAMES",
                "GIVEN NAME"
            ]);

    }

    return cleanPersonName(value);

}


// =======================================
// SURNAME
// =======================================

function findSurname(text) {

    const value =
        findAfterLabel(text, [
            "SURNAME",
            "SUR NAME",
            "LAST NAME",
            "FAMILY NAME"
        ]);

    return cleanPersonName(value);

}


// =======================================
// GIVEN NAME
// =======================================

function findGivenName(text) {

    const value =
        findAfterLabel(text, [
            "GIVEN NAMES",
            "GIVEN NAME",
            "FIRST NAME",
            "FORENAME"
        ]);

    return cleanPersonName(value);

}


// =======================================
// PLACE OF BIRTH
// =======================================

function findPlaceOfBirth(text) {

    return findFlexibleLabel(text, [
        "PLACE OF BIRTH",
        "PLACEOF BIRTH",
        "BIRTH PLACE"
    ]);

}


// =======================================
// PLACE OF ISSUE
// =======================================

function findPlaceOfIssue(text) {

    return findFlexibleLabel(text, [
        "PLACE OF ISSUE",
        "PLACEOF ISSUE",
        "ISSUING PLACE"
    ]);

}


// =======================================
// ISSUING AUTHORITY
// =======================================

function findAuthority(text) {

    return findFlexibleLabel(text, [
        "ISSUING AUTHORITY",
        "AUTHORITY",
        "ISSUED BY"
    ]);

}


// =======================================
// PERSONAL NUMBER
// =======================================

function findPersonalNumber(text) {

    return findFlexibleLabel(text, [
        "PERSONAL NO",
        "PERSONAL NUMBER",
        "PERSONAL ID",
        "NATIONAL ID",
        "NATIONAL ID NO",
        "IDENTIFICATION NO"
    ]);

}


// =======================================
// PREVIOUS PASSPORT
// =======================================

function findPreviousPassport(text) {

    return findFlexibleLabel(text, [
        "PREVIOUS PASSPORT",
        "PREVIOUS PASSPORT NO",
        "PREVIOUS PASSPORT NUMBER",
        "OLD PASSPORT",
        "OLD PASSPORT NO"
    ]);

}


// =======================================
// ADDRESS
// =======================================

function findAddress(text) {

    return findFlexibleLabel(text, [
        "PRESENT ADDRESS",
        "PERMANENT ADDRESS",
        "CURRENT ADDRESS",
        "RESIDENTIAL ADDRESS",
        "ADDRESS"
    ]);

}


// =======================================
// FATHER NAME
// =======================================

function findFather(text) {

    return findFlexibleLabel(text, [
        "FATHER'S NAME",
        "FATHER NAME",
        "FATHER"
    ]);

}


// =======================================
// MOTHER NAME
// =======================================

function findMother(text) {

    return findFlexibleLabel(text, [
        "MOTHER'S NAME",
        "MOTHER NAME",
        "MOTHER"
    ]);

}


// =======================================
// SPOUSE NAME
// =======================================

function findSpouse(text) {

    return findFlexibleLabel(text, [
        "SPOUSE NAME",
        "SPOUSE'S NAME",
        "SPOUSE",
        "HUSBAND NAME",
        "WIFE NAME"
    ]);

}


// =======================================
// PROFESSION
// =======================================

function findProfession(text) {

    return findFlexibleLabel(text, [
        "PROFESSION",
        "OCCUPATION",
        "JOB"
    ]);

}


// =======================================
// FIND MRZ LINES
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

            if (line.length < 25) {

                return false;

            }

            const allowed =
                line.replace(
                    /[A-Z0-9<]/g,
                    ""
                );

            return allowed.length <= 3;

        });

    return candidates.slice(-2);

}


// =======================================
// NORMALIZE MRZ LINE
// =======================================

function normalizeMRZLine(line) {

    return String(line || "")
        .toUpperCase()
        .replace(/\s/g, "")
        .replace(/[^A-Z0-9<]/g, "");

}


// =======================================
// REPAIR MRZ
// =======================================

function repairMRZ(line) {

    let value =
        normalizeMRZLine(line);

    /*
     * MRZ normally uses < as filler.
     * OCR often reads:
     * < as K / C / /
     * 0 as O
     * 1 as I
     */

    value =
        value
            .replace(/«/g, "<")
            .replace(/</g, "<");

    return value;

}


// =======================================
// PARSE MRZ
// =======================================

function parseMRZ(mrzLines) {

    const result = {

        passportNo: "",
        nationality: "",
        dob: "",
        sex: "",
        expiryDate: "",
        surname: "",
        givenName: "",
        fullName: ""

    };

    if (
        !mrzLines ||
        mrzLines.length < 2
    ) {

        return result;

    }

    let line1 =
        repairMRZ(mrzLines[0]);

    let line2 =
        repairMRZ(mrzLines[1]);


    // ===================================
    // FIND THE LINE THAT STARTS WITH P<
    // ===================================

    if (!line1.startsWith("P<")) {

        if (line2.startsWith("P<")) {

            const temp = line1;

            line1 = line2;
            line2 = temp;

        }

    }


    if (!line1.startsWith("P<")) {

        return result;

    }


    // ===================================
    // MRZ LINE 1
    //
    // P<BGDSURNAME<<GIVEN<NAMES<<<<<<
    // ===================================

    const namePart =
        line1.substring(5);

    const namePieces =
        namePart.split("<<");

    if (namePieces.length >= 1) {

        result.surname =
            namePieces[0]
                .replace(/</g, " ")
                .replace(/\s+/g, " ")
                .trim();

    }

    if (namePieces.length >= 2) {

        result.givenName =
            namePieces[1]
                .replace(/</g, " ")
                .replace(/\s+/g, " ")
                .trim();

    }


    if (
        result.surname ||
        result.givenName
    ) {

        result.fullName =
            `${result.givenName} ${result.surname}`
                .trim();

    }


    // ===================================
    // MRZ LINE 2
    //
    // PASSPORT NUMBER
    // NATIONALITY
    // DOB
    // SEX
    // EXPIRY
    // ===================================

    if (line2.length >= 28) {

        let passportNo =
            line2.substring(0, 9)
                .replace(/</g, "")
                .trim();

        let nationality =
            line2.substring(10, 13);

        let dob =
            line2.substring(13, 19);

        let sex =
            line2.substring(20, 21);

        let expiry =
            line2.substring(21, 27);


        // =================================
        // PASSPORT NUMBER CLEAN
        // =================================

        passportNo =
            passportNo
                .replace(/O/g, "0")
                .replace(/I/g, "1")
                .replace(/S/g, "5")
                .replace(/B/g, "8");


        if (
            /^[A-Z0-9]{6,9}$/.test(
                passportNo
            )
        ) {

            result.passportNo =
                passportNo;

        }


        // =================================
        // NATIONALITY
        // =================================

        if (
            /^[A-Z]{3}$/.test(
                nationality
            )
        ) {

            result.nationality =
                nationality;

        }


        // =================================
        // DOB
        // =================================

        const parsedDOB =
            mrzDate(
                dob,
                "dob"
            );

        if (parsedDOB) {

            result.dob =
                parsedDOB;

        }


        // =================================
        // SEX
        // =================================

        if (
            sex === "M" ||
            sex === "F"
        ) {

            result.sex =
                sex;

        }


        // =================================
        // EXPIRY
        // =================================

        const parsedExpiry =
            mrzDate(
                expiry,
                "expiry"
            );

        if (parsedExpiry) {

            result.expiryDate =
                parsedExpiry;

        }

    }


    return result;

}


// =======================================
// OCR IMAGE PREPARATION
// =======================================

async function prepareImage(buffer) {

    return sharp(buffer)
        .rotate()
        .resize({
            width: 2400,
            withoutEnlargement: false
        })
        .grayscale()
        .normalize()
        .sharpen()
        .png()
        .toBuffer();

}


// =======================================
// OCR
// =======================================

async function runOCR(buffer) {

    console.log("OCR START");

    const processed =
        await prepareImage(buffer);

    const worker =
        await createWorker("eng");

    try {

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


        console.log("OCR DONE");

        console.log(
            "========== RAW OCR =========="
        );

        console.log(text);

        console.log(
            "=============================="
        );


        return text;

    }
    finally {

        await worker.terminate();

    }

}


// =======================================
// MERGE DATA
// =======================================

function mergeData(primary, secondary) {

    const result = {};

    const keys =
        new Set([
            ...Object.keys(primary || {}),
            ...Object.keys(secondary || {})
        ]);

    for (const key of keys) {

        result[key] =
            primary[key] ||
            secondary[key] ||
            "";

    }

    return result;

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
                "PASSPORT RECEIVED:",
                req.file.originalname
            );

            console.log(
                "FILE SIZE:",
                req.file.size
            );

            console.log(
                "================================="
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
            // FIND MRZ
            // =================================

            const mrz =
                findMRZ(text);


            console.log(
                "MRZ LINES:",
                mrz
            );


            // =================================
            // PARSE MRZ
            // =================================

            const mrzData =
                parseMRZ(mrz);


            console.log(
                "MRZ DATA:",
                mrzData
            );


            // =================================
            // NON MRZ DATA
            // =================================

            const normalData = {

                fullName:
                    findName(text),

                surname:
                    findSurname(text),

                givenName:
                    findGivenName(text),

                passportNo:
                    findPassportNumber(text),

                nationality:
                    findNationality(text),

                dob:
                    findDOB(text),

                sex:
                    findSex(text),

                placeOfBirth:
                    findPlaceOfBirth(text),

                issueDate:
                    findIssueDate(text),

                expiryDate:
                    findExpiry(text),

                placeOfIssue:
                    findPlaceOfIssue(text),

                issuingAuthority:
                    findAuthority(text),

                personalNo:
                    findPersonalNumber(text),

                previousPassportNo:
                    findPreviousPassport(text),

                address:
                    findAddress(text),

                fatherName:
                    findFather(text),

                motherName:
                    findMother(text),

                spouseName:
                    findSpouse(text),

                profession:
                    findProfession(text)

            };


            // =================================
            // MRZ HAS PRIORITY FOR CORE FIELDS
            // =================================

            const data = {

                fullName:
                    mrzData.fullName ||
                    normalData.fullName,

                surname:
                    mrzData.surname ||
                    normalData.surname,

                givenName:
                    mrzData.givenName ||
                    normalData.givenName,

                passportNo:
                    mrzData.passportNo ||
                    normalData.passportNo,

                nationality:
                    mrzData.nationality ||
                    normalData.nationality,

                dob:
                    mrzData.dob ||
                    normalData.dob,

                sex:
                    mrzData.sex ||
                    normalData.sex,

                placeOfBirth:
                    normalData.placeOfBirth,

                issueDate:
                    normalData.issueDate,

                expiryDate:
                    mrzData.expiryDate ||
                    normalData.expiryDate,

                placeOfIssue:
                    normalData.placeOfIssue,

                issuingAuthority:
                    normalData.issuingAuthority,

                personalNo:
                    normalData.personalNo,

                previousPassportNo:
                    normalData.previousPassportNo,

                address:
                    normalData.address,

                fatherName:
                    normalData.fatherName,

                motherName:
                    normalData.motherName,

                spouseName:
                    normalData.spouseName,

                profession:
                    normalData.profession,

                mrz:
                    mrz

            };


            // =================================
            // FINAL NAME FALLBACK
            // =================================

            if (
                !data.fullName &&
                (
                    data.givenName ||
                    data.surname
                )
            ) {

                data.fullName =
                    `${data.givenName || ""} ${data.surname || ""}`
                        .trim();

            }


            // =================================
            // BANGLADESH FALLBACK
            // =================================

            if (
                !data.nationality &&
                (
                    /BANGLADESH/i.test(text) ||
                    mrzData.nationality === "BGD"
                )
            ) {

                data.nationality =
                    "BGD";

            }


            // =================================
            // DEBUG
            // =================================

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

            console.log(
                "================================="
            );


            return res.json({

                success: true,

                message:
                    "Full Passport OCR completed",

                version:
                    "5.0.0",

                mode:
                    "FULL MRZ + NON-MRZ",

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
// START SERVER
// =======================================

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `ARIF VISA API SERVER v5.0 RUNNING ON PORT ${PORT}`
        );

    }
);
