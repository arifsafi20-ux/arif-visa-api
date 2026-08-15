// =======================================
// ARIF VISA AUTO FILL PRO
// API SERVER v4.0
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

        version: "4.0.0",

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
// NORMALIZE TEXT
// =======================================

function normalize(value) {

    if (!value) return "";

    return value
        .replace(/[|]/g, "I")
        .replace(/\s+/g, " ")
        .trim();

}


// =======================================
// GET VALUE AFTER LABEL
// =======================================

function findAfterLabel(text, labels) {

    const lines = text
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

    for (let i = 0; i < lines.length; i++) {

        const line = lines[i];

        for (const label of labels) {

            const regex = new RegExp(
                "^" + label + "\\s*[:\\-]?\\s*(.*)$",
                "i"
            );

            const match = line.match(regex);

            if (match) {

                let value = match[1].trim();

                if (!value && lines[i + 1]) {

                    value = lines[i + 1].trim();

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

        /DOCUMENT\s*(?:NO|NUMBER)?\s*[:\-]?\s*([A-Z][A-Z0-9]{6,9})/i,

        /\b([A-Z][0-9]{7,8})\b/

    ];

    for (const pattern of patterns) {

        const match = text.match(pattern);

        if (match && match[1]) {

            return match[1]
                .replace(/\s/g, "")
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

    value = value
        .toUpperCase()
        .replace(/[OQ]/g, "0")
        .replace(/[IL]/g, "1")
        .replace(/[SZ]/g, "5")
        .replace(/[B]/g, "8")
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
// DATE OF BIRTH
// =======================================

function findDOB(text) {

    const value = findAfterLabel(text, [

        "DATE OF BIRTH",
        "DATEOF BIRTH",
        "DOB",
        "BIRTH DATE"

    ]);

    return normalizeDate(value);

}


// =======================================
// ISSUE DATE
// =======================================

function findIssueDate(text) {

    const value = findAfterLabel(text, [

        "DATE OF ISSUE",
        "DATEOF ISSUE",
        "ISSUE DATE",
        "ISSUED"

    ]);

    return normalizeDate(value);

}


// =======================================
// EXPIRY DATE
// =======================================

function findExpiry(text) {

    const value = findAfterLabel(text, [

        "DATE OF EXPIRY",
        "DATEOF EXPIRY",
        "EXPIRY DATE",
        "EXPIRATION DATE",
        "EXPIRY"

    ]);

    return normalizeDate(value);

}


// =======================================
// NATIONALITY
// =======================================

function findNationality(text) {

    const value = findAfterLabel(text, [

        "NATIONALITY"

    ]);

    if (value) {

        const upper = value.toUpperCase();

        if (upper.includes("BANGLADESH")) {

            return "BGD";

        }

        const match =
            upper.match(/\b[A-Z]{3}\b/);

        if (match) {

            return match[0];

        }

    }

    const upper = text.toUpperCase();

    if (upper.includes("BANGLADESH")) {

        return "BGD";

    }

    if (/\bBGD\b/.test(upper)) {

        return "BGD";

    }

    return "";

}


// =======================================
// SEX
// =======================================

function findSex(text) {

    const value = findAfterLabel(text, [

        "SEX",
        "GENDER"

    ]);

    if (!value) {

        return "";

    }

    const upper = value.toUpperCase();

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
// FULL NAME
// =======================================

function findName(text) {

    let value = findAfterLabel(text, [

        "FULL NAME",
        "NAME"

    ]);

    if (!value) {

        value = findAfterLabel(text, [

            "GIVEN NAMES",
            "GIVEN NAME"

        ]);

    }

    return value
        .replace(/[^A-Z .'-]/gi, "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

}


// =======================================
// SURNAME
// =======================================

function findSurname(text) {

    const value = findAfterLabel(text, [

        "SURNAME",
        "LAST NAME",
        "FAMILY NAME"

    ]);

    return value
        .replace(/[^A-Z .'-]/gi, "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

}


// =======================================
// GIVEN NAME
// =======================================

function findGivenName(text) {

    const value = findAfterLabel(text, [

        "GIVEN NAMES",
        "GIVEN NAME",
        "FIRST NAME"

    ]);

    return value
        .replace(/[^A-Z .'-]/gi, "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

}


// =======================================
// PLACE OF BIRTH
// =======================================

function findPlaceOfBirth(text) {

    return findAfterLabel(text, [

        "PLACE OF BIRTH",
        "PLACEOF BIRTH",
        "BIRTH PLACE"

    ]);

}


// =======================================
// PLACE OF ISSUE
// =======================================

function findPlaceOfIssue(text) {

    return findAfterLabel(text, [

        "PLACE OF ISSUE",
        "PLACEOF ISSUE",
        "ISSUING PLACE"

    ]);

}


// =======================================
// ISSUING AUTHORITY
// =======================================

function findAuthority(text) {

    return findAfterLabel(text, [

        "ISSUING AUTHORITY",
        "AUTHORITY",
        "ISSUED BY"

    ]);

}


// =======================================
// PERSONAL NUMBER
// =======================================

function findPersonalNumber(text) {

    return findAfterLabel(text, [

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

    return findAfterLabel(text, [

        "PREVIOUS PASSPORT",
        "PREVIOUS PASSPORT NO",
        "OLD PASSPORT",
        "OLD PASSPORT NO"

    ]);

}


// =======================================
// ADDRESS
// =======================================

function findAddress(text) {

    return findAfterLabel(text, [

        "ADDRESS",
        "PRESENT ADDRESS",
        "PERMANENT ADDRESS",
        "CURRENT ADDRESS",
        "RESIDENTIAL ADDRESS"

    ]);

}


// =======================================
// FATHER NAME
// =======================================

function findFather(text) {

    return findAfterLabel(text, [

        "FATHER'S NAME",
        "FATHER NAME",
        "FATHER"

    ]);

}


// =======================================
// MOTHER NAME
// =======================================

function findMother(text) {

    return findAfterLabel(text, [

        "MOTHER'S NAME",
        "MOTHER NAME",
        "MOTHER"

    ]);

}


// =======================================
// SPOUSE NAME
// =======================================

function findSpouse(text) {

    return findAfterLabel(text, [

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

    return findAfterLabel(text, [

        "PROFESSION",
        "OCCUPATION",
        "JOB"

    ]);

}


// =======================================
// MRZ
// =======================================

function findMRZ(text) {

    const lines = text
        .split("\n")
        .map(line =>
            line
                .replace(/\s/g, "")
                .toUpperCase()
        )
        .filter(line => line.length >= 25);

    const possible = lines.filter(line =>
        /^[A-Z0-9<]+$/.test(line)
    );

    return possible.slice(-2);

}


// =======================================
// OCR
// =======================================

async function runOCR(buffer) {

    console.log("OCR START");

    const processed = await sharp(buffer)
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


    const worker = await createWorker("eng");


    await worker.setParameters({

        tessedit_pageseg_mode: "6",

        preserve_interword_spaces: "1"

    });


    const result =
        await worker.recognize(processed);


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
                "Passport Received:",
                req.file.originalname
            );


            const rawText =
                await runOCR(
                    req.file.buffer
                );


            const text =
                cleanText(rawText);


            // =================================
            // FULL PASSPORT DATA
            // =================================

            const data = {

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
                    findProfession(text),

                mrz:
                    findMRZ(text)

            };


            console.log(
                "FULL EXTRACTED DATA:",
                data
            );


            return res.json({

                success: true,

                message:
                    "Full Passport OCR completed",

                version:
                    "4.0.0",

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
            `ARIF VISA API SERVER RUNNING ON PORT ${PORT}`
        );

    }
);
