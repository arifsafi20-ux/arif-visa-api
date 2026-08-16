// =======================================
// ARIF VISA AUTO FILL PRO
// API SERVER v6.0
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

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 15 * 1024 * 1024
    }
});


// =======================================
// ROOT
// =======================================

app.get("/", (req, res) => {

    res.json({
        status: "ARIF VISA API RUNNING",
        version: "6.0.0",
        ocr: "READY",
        mode: "PRINTED PASSPORT FIRST - MRZ BACKUP"
    });

});


// =======================================
// CLEAN TEXT
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


// =======================================
// NORMALIZE VALUE
// =======================================

function normalize(value) {

    if (!value) return "";

    return String(value)
        .replace(/[|]/g, "I")
        .replace(/\s+/g, " ")
        .trim();

}


// =======================================
// CLEAN PERSON NAME
// =======================================

function cleanName(value) {

    if (!value) return "";

    return String(value)
        .replace(/[^A-Za-z .'-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

}


// =======================================
// OCR LINE ARRAY
// =======================================

function getLines(text) {

    return cleanText(text)
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);

}


// =======================================
// FIND VALUE AFTER LABEL
// =======================================

function findAfterLabel(text, labels) {

    const lines = getLines(text);

    for (let i = 0; i < lines.length; i++) {

        const current = lines[i];

        for (const label of labels) {

            const regex = new RegExp(
                "^" +
                label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                "\\s*[:\\-]?\\s*(.*)$",
                "i"
            );

            const match = current.match(regex);

            if (!match) continue;

            let value = (match[1] || "").trim();

            if (!value && lines[i + 1]) {
                value = lines[i + 1].trim();
            }

            if (value) {
                return normalize(value);
            }

        }

    }

    return "";

}


// =======================================
// FIND VALUE ANYWHERE AFTER LABEL
// =======================================

function findLooseLabel(text, labels) {

    const lines = getLines(text);

    for (let i = 0; i < lines.length; i++) {

        const line = lines[i];

        for (const label of labels) {

            const regex = new RegExp(
                label +
                "\\s*[:\\-]?\\s*(.*)$",
                "i"
            );

            const match = line.match(regex);

            if (match) {

                let value = (match[1] || "").trim();

                if (value) {

                    return normalize(value);

                }

                if (lines[i + 1]) {

                    return normalize(
                        lines[i + 1]
                    );

                }

            }

        }

    }

    return "";

}


// =======================================
// PASSPORT NUMBER
// PRINTED DATA FIRST
// =======================================

function findPassportNumber(text) {

    const lines = getLines(text);

    const patterns = [

        /Passport\s*Number\s+([A-Z]\d{7,8})/i,

        /Passport\s*No\.?\s+([A-Z]\d{7,8})/i,

        /Passport\s*Number\s*[:\-]?\s*([A-Z0-9]{7,10})/i,

        /Passport\s*No\.?\s*[:\-]?\s*([A-Z0-9]{7,10})/i,

        /Document\s*Number\s*[:\-]?\s*([A-Z0-9]{7,10})/i

    ];

    for (const line of lines) {

        for (const pattern of patterns) {

            const match = line.match(pattern);

            if (match && match[1]) {

                const value =
                    match[1]
                        .replace(/\s/g, "")
                        .toUpperCase();

                if (
                    /^[A-Z]\d{7,8}$/.test(value)
                ) {

                    return value;

                }

            }

        }

    }

    // Secondary printed OCR search
    const allText =
        text.toUpperCase();

    const possible =
        allText.match(
            /\b[A-Z]\d{7,8}\b/g
        );

    if (possible && possible.length) {

        // Prefer A + 8 digits
        const preferred =
            possible.find(x =>
                /^A\d{8}$/.test(x)
            );

        if (preferred) return preferred;

        return possible[0];

    }

    return "";

}


// =======================================
// DATE NORMALIZER
// =======================================

function normalizeDate(value) {

    if (!value) return "";

    let v = String(value)
        .toUpperCase()
        .replace(/O/g, "0")
        .replace(/Q/g, "0")
        .replace(/I/g, "1")
        .replace(/L/g, "1")
        .replace(/Z/g, "2")
        .replace(/S/g, "5")
        .replace(/B/g, "8")
        .replace(/\s+/g, " ")
        .trim();

    let m;

    // 04 OCT 1983
    m = v.match(
        /^(\d{1,2})\s+([A-Z]{3,9})\s+(\d{4})$/
    );

    if (m) {

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

        const month =
            months[m[2].substring(0, 3)];

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
    m = v.match(
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
    m = v.match(
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

    // DDMMYYYY
    m = v.match(
        /^(\d{2})(\d{2})(\d{4})$/
    );

    if (m) {

        return (
            m[3] +
            "-" +
            m[2] +
            "-" +
            m[1]
        );

    }

    return "";

}


// =======================================
// FIND DATE
// =======================================

function findDate(text, labels) {

    const value =
        findLooseLabel(
            text,
            labels
        );

    return normalizeDate(value);

}


// =======================================
// NATIONALITY
// =======================================

function findNationality(text) {

    const value =
        findLooseLabel(
            text,
            [
                "Nationality",
                "Nationality"
            ]
        );

    const upper =
        String(value || "")
            .toUpperCase();

    if (
        upper.includes("BANGLADESH") ||
        upper.includes("BANGLADESHI")
    ) {

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

    const value =
        findLooseLabel(
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
// SURNAME
// =======================================

function findSurname(text) {

    const value =
        findLooseLabel(
            text,
            [
                "Surname",
                "Family Name",
                "Last Name"
            ]
        );

    return cleanName(value);

}


// =======================================
// GIVEN NAME
// =======================================

function findGivenName(text) {

    const value =
        findLooseLabel(
            text,
            [
                "Given Name",
                "Given Names",
                "First Name"
            ]
        );

    return cleanName(value);

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

    // Emergency/contact name is NOT used
    // as passport full name.

    return "";

}


// =======================================
// FATHER
// =======================================

function findFather(text) {

    const value =
        findLooseLabel(
            text,
            [
                "Father's Name",
                "Father’s Name",
                "Father Name",
                "Father"
            ]
        );

    return cleanName(value);

}


// =======================================
// MOTHER
// =======================================

function findMother(text) {

    const value =
        findLooseLabel(
            text,
            [
                "Mother's Name",
                "Mother’s Name",
                "Mother Name",
                "Mother"
            ]
        );

    return cleanName(value);

}


// =======================================
// SPOUSE
// =======================================

function findSpouse(text) {

    const value =
        findLooseLabel(
            text,
            [
                "Spouse's Name",
                "Spouse’s Name",
                "Spouse Name",
                "Spouse"
            ]
        );

    const cleaned =
        cleanName(value);

    // Reject obvious OCR garbage
    if (
        !cleaned ||
        cleaned.length < 2 ||
        /^(S|A|N|CR|SOUTH)$/.test(cleaned)
    ) {

        return "";

    }

    return cleaned;

}


// =======================================
// PLACE OF BIRTH
// =======================================

function findPlaceOfBirth(text) {

    return normalize(
        findLooseLabel(
            text,
            [
                "Place of Birth",
                "Place Of Birth",
                "Birth Place"
            ]
        )
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
            "Date Of Issue",
            "Dateof Issue",
            "Issue Date",
            "Issued"
        ]
    );

}


// =======================================
// EXPIRY DATE
// =======================================

function findExpiryDate(text) {

    return findDate(
        text,
        [
            "Date of Expiry",
            "Date Of Expiry",
            "Dateof Expiry",
            "Expiry Date",
            "Expiration Date",
            "Expiry"
        ]
    );

}


// =======================================
// DOB
// =======================================

function findDOB(text) {

    return findDate(
        text,
        [
            "Date of Birth",
            "Date Of Birth",
            "Dateof Birth",
            "Birth Date",
            "DOB"
        ]
    );

}


// =======================================
// PLACE OF ISSUE
// =======================================

function findPlaceOfIssue(text) {

    return normalize(
        findLooseLabel(
            text,
            [
                "Place of Issue",
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

    return normalize(
        findLooseLabel(
            text,
            [
                "Issuing Authority",
                "Issuing Authority",
                "Authority",
                "Issued By"
            ]
        )
    );

}


// =======================================
// PERSONAL NUMBER
// =======================================

function findPersonalNumber(text) {

    const value =
        findLooseLabel(
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
        value.match(
            /\d{8,17}/
        );

    return match
        ? match[0]
        : value;

}


// =======================================
// PREVIOUS PASSPORT
// =======================================

function findPreviousPassport(text) {

    const value =
        findLooseLabel(
            text,
            [
                "Previous Passport No",
                "Previous Passport",
                "Old Passport No",
                "Old Passport"
            ]
        );

    const cleaned =
        normalize(value)
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
        findLooseLabel(
            text,
            [
                "Permanent Address",
                "Present Address",
                "
