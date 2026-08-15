// =======================================
// ARIF VISA AUTO FILL PRO
// API SERVER v5.2
// FULL PASSPORT OCR
// MRZ + NON-MRZ
// BANGLADESH PASSPORT OPTIMIZED
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
        version: "5.2.0",
        ocr: "READY",
        mode: "FULL PASSPORT OCR - MRZ + NON-MRZ"
    });

});


// =======================================
// TEXT CLEAN
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


function linesOf(text) {

    return cleanText(text)
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);

}


function cleanName(value) {

    if (!value) return "";

    let v = String(value)
        .replace(/[^A-Z .'-]/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

    if (
        !v ||
        /^[-—–]+$/.test(v) ||
        /^S\s*[-—–]?$/.test(v) ||
        /^N$/.test(v) ||
        /^CR$/.test(v)
    ) {
        return "";
    }

    return v;
}


function cleanValue(value) {

    if (!value) return "";

    let v = String(value)
        .replace(/[—–]/g, "-")
        .replace(/\s+/g, " ")
        .trim();

    if (
        !v ||
        /^[-]+$/.test(v) ||
        /^S\s*[-]+$/.test(v) ||
        /^CR$/i.test(v)
    ) {
        return "";
    }

    return v;
}


// =======================================
// SMART LABEL SEARCH
// =======================================

function findAfterLabel(text, labels, cleaner = cleanValue) {

    const lines = linesOf(text);

    for (let i = 0; i < lines.length; i++) {

        const line = lines[i];

        for (const label of labels) {

            const regex = new RegExp(
                label +
                "\\s*[:.\\-]?\\s*(.*)$",
                "i"
            );

            const match = line.match(regex);

            if (!match) continue;

            // Same line
            let value = cleaner(match[1]);

            if (value) {
                return value;
            }

            // Next few lines
            for (let j = 1; j <= 4; j++) {

                if (!lines[i + j]) continue;

                value =
                    cleaner(lines[i + j]);

                if (value) {
                    return value;
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

        /Passport\s*Number[\s:.\-]*([A-Z]\d{7,8})/i,

        /Passport\s*No[\s:.\-]*([A-Z]\d{7,8})/i,

        /Passport\s*Number[\s\S]{0,80}?\b([A-Z]\d{7,8})\b/i,

        /\b([A-Z]\d{7,8})\b/

    ];

    for (const p of patterns) {

        const m = text.match(p);

        if (m && m[1]) {

            return m[1]
                .replace(/\s/g, "")
                .toUpperCase();

        }
    }

    return "";
}


// =======================================
// NATIONALITY
// =======================================

function findNationality(text) {

    if (/BANGLADESH/i.test(text)) {
        return "BGD";
    }

    if (/BANGLADESHI/i.test(text)) {
        return "BGD";
    }

    if (/\bBGD\b/i.test(text)) {
        return "BGD";
    }

    return "";
}


// =======================================
// NAME
// =======================================

function findNames(text) {

    const lines = linesOf(text);

    let surname = "";
    let givenName = "";

    // Surname
    for (let i = 0; i < lines.length; i++) {

        if (/Surname/i.test(lines[i])) {

            let value =
                lines[i]
                    .replace(/.*Surname/i, "")
                    .replace(/[:.\-]/g, "")
                    .trim();

            if (!value) {

                for (let j = 1; j <= 3; j++) {

                    if (lines[i + j]) {

                        value =
                            cleanName(lines[i + j]);

                        if (value) break;
                    }
                }
            }

            value = cleanName(value);

            if (
                value &&
                !/^[A-Z]{1,2}$/.test(value)
            ) {
                surname = value;
                break;
            }
        }
    }


    // Given Name
    for (let i = 0; i < lines.length; i++) {

        if (/Given\s*Name/i.test(lines[i])) {

            let value =
                lines[i]
                    .replace(/.*Given\s*Name/i, "")
                    .replace(/[:.\-]/g, "")
                    .trim();

            if (!value) {

                for (let j = 1; j <= 3; j++) {

                    if (lines[i + j]) {

                        value =
                            cleanName(lines[i + j]);

                        if (value) break;
                    }
                }
            }

            value = cleanName(value);

            if (value) {
                givenName = value;
                break;
            }
        }
    }


    // OCR fallback from known pattern
    if (!givenName) {

        const m =
            text.match(
                /Given\s+Name[\s\S]{0,100}?((?:MD|MOHAMMAD|ABDUL)[A-Z .'-]*)/i
            );

        if (m) {
            givenName =
                cleanName(m[1]);
        }
    }


    return {

        surname,

        givenName,

        fullName:
            `${givenName} ${surname}`
                .trim()

    };
}


// =======================================
// FATHER
// =======================================

function findFather(text) {

    return cleanName(
        findAfterLabel(
            text,
            [
                "Father's\\s+Name",
                "Father's\\s+Mame",
                "Father\\s+Name",
                "Father"
            ],
            cleanName
        )
    );
}


// =======================================
// MOTHER
// =======================================

function findMother(text) {

    return cleanName(
        findAfterLabel(
            text,
            [
                "Mother's\\s+Name",
                "Mother's\\s+Mame",
                "Mother\\s+Name",
                "Mother"
            ],
            cleanName
        )
    );
}


// =======================================
// SPOUSE
// =======================================

function findSpouse(text) {

    return cleanName(
        findAfterLabel(
            text,
            [
                "Spouse's\\s+Name",
                "Spouse's\\s+Mame",
                "Spouse\\s+Name",
                "Spouse"
            ],
            cleanName
        )
    );
}


// =======================================
// ADDRESS
// =======================================

function findAddress(text) {

    return cleanValue(
        findAfterLabel(
            text,
            [
                "Permanent\\s+Address",
                "Present\\s+Address",
                "Current\\s+Address",
                "Residential\\s+Address"
            ],
            cleanValue
        )
    );
}


// =======================================
// PERSONAL NUMBER
// =======================================

function findPersonalNo(text) {

    const m =
        text.match(
            /Personal\s*No[\s\S]{0,100}?(\d{8,17})/i
        );

    return m ? m[1] : "";
}


// =======================================
// DATE HELPER
// =======================================

function normalizeDate(value) {

    if (!value) return "";

    let v =
        String(value)
            .toUpperCase()
            .replace(/0CT/g, "OCT")
            .replace(/OCT/g, "OCT")
            .replace(/O/g, "0")
            .replace(/\s+/g, " ")
            .trim();


    const months = {

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


    let m =
        v.match(
            /\b(\d{1,2})\s*([A-Z]{3})\s*(\d{4})\b/
        );

    if (m && months[m[2]]) {

        return (
            `${m[3]}-${months[m[2]]}-${m[1].padStart(2, "0")}`
        );
    }


    m =
        v.match(
            /\b(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})\b/
        );

    if (m) {

        return `${m[3]}-${m[2]}-${m[1]}`;
    }


    return "";
}


// =======================================
// DOB
// =======================================

function findDOB(text) {

    const m =
        text.match(
            /Date\s*of\s*Birth[\s\S]{0,100}?(\d{1,2}\s*[A-Z0-9]{3}\s*\d{4})/i
        );

    return m
        ? normalizeDate(m[1])
        : "";
}


// =======================================
// ISSUE DATE
// =======================================

function findIssueDate(text) {

    const m =
        text.match(
            /Date\s*of\s*Issue[\s\S]{0,100}?(\d{1,2}\s*[A-Z0-9]{3}\s*\d{4})/i
        );

    return m
        ? normalizeDate(m[1])
        : "";
}


// =======================================
// EXPIRY DATE
// =======================================

function findExpiryDate(text) {

    const m =
        text.match(
            /Date\s*of\s*Expiry[\s\S]{0,120}?(\d{1,2}\s*[A-Z0-9]{3}\s*\d{4})/i
        );

    if (m) {
        return normalizeDate(m[1]);
    }


    const m2 =
        text.match(
            /Expiry[\s\S]{0,120}?(\d{1,2}\s*[A-Z0-9]{3}\s*\d{4})/i
        );

    return m2
        ? normalizeDate(m2[1])
        : "";
}


// =======================================
// SEX
// =======================================

function findSex(text) {

    const m =
        text.match(
            /\bSex\b[\s:.\-]*([MF])\b/i
        );

    if (m) {
        return m[1].toUpperCase();
    }

    return "";
}


// =======================================
// PLACE OF BIRTH
// =======================================

function findPlaceOfBirth(text) {

    const m =
        text.match(
            /Place\s*of\s*Birth[\s:.\-]*([A-Z][A-Z ]{2,})/i
        );

    return m
        ? cleanName(m[1])
        : "";
}


// =======================================
// ISSUING AUTHORITY
// =======================================

function findAuthority(text) {

    const m =
        text.match(
            /Issuing\s*Authority[\s:.\-]*([A-Z][A-Z ]{2,})/i
        );

    return m
        ? cleanName(m[1])
        : "";
}


// =======================================
// PROFESSION
// =======================================

function findProfession(text) {

    return cleanValue(
        findAfterLabel(
            text,
            [
                "Profession",
                "Occupation"
            ],
            cleanValue
        )
    );
}


// =======================================
// PREVIOUS PASSPORT
// =======================================

function findPreviousPassport(text) {

    const m =
        text.match(
            /Previous\s*Passport\s*No[\s:.\-]*([A-Z0-9]+)/i
        );

    return m
        ? m[1].toUpperCase()
        : "";
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
                width: 3000,
                withoutEnlargement: false
            })
            .grayscale()
            .normalize()
            .sharpen()
            .png()
            .toBuffer();

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


            const names =
                findNames(text);


            const data = {

                fullName:
                    names.fullName,

                surname:
                    names.surname,

                givenName:
                    names.givenName,

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
                    findExpiryDate(text),

                placeOfIssue:
                    "",

                issuingAuthority:
                    findAuthority(text),

                personalNo:
                    findPersonalNo(text),

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
                    []
            };


            // =================================
            // MRZ
            // =================================

            data.mrz =
                linesOf(text)
                    .map(x =>
                        x
                            .replace(/\s/g, "")
                            .toUpperCase()
                    )
                    .filter(
                        x =>
                            x.length >= 30 &&
                            /^[A-Z0-9<]+$/.test(x)
                    )
                    .slice(-2);


            // =================================
            // NAME SAFETY
            // =================================

            if (
                /L{5,}/i.test(data.surname)
            ) {
                data.surname = "";
            }


            if (
                /L{5,}/i.test(data.givenName)
            ) {
                data.givenName = "";
            }


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
                    "5.2.0",

                mode:
                    "FULL MRZ + NON-MRZ",

                data,

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
            `ARIF VISA API SERVER v5.2 RUNNING ON PORT ${PORT}`
        );

    }
);
