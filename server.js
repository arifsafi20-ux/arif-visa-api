// ===================================
// ARIF VISA AUTO FILL PRO
// API SERVER
// ===================================

const express = require("express");
const multer = require("multer");
const cors = require("cors");

const app = express();


// ===================================
// MIDDLEWARE
// ===================================

app.use(cors());
app.use(express.json());


// ===================================
// FILE UPLOAD
// ===================================

const upload = multer({
    storage: multer.memoryStorage()
});


// ===================================
// TEST API
// ===================================

app.get("/", (req, res) => {

    res.json({
        status: "ARIF VISA API RUNNING",
        version: "1.0.0"
    });

});


// ===================================
// PASSPORT RECEIVE API
// ===================================

app.post(
    "/read-passport",
    upload.single("passport"),
    (req, res) => {

        try {

            // Check passport file

            if (!req.file) {

                return res.status(400).json({

                    success: false,
                    message: "No Passport File"

                });

            }


            // Console information

            console.log(
                "Passport Received:",
                req.file.originalname
            );

            console.log(
                "File Size:",
                req.file.size
            );

            console.log(
                "File Type:",
                req.file.mimetype
            );


            // ===================================
            // TEMPORARY PASSPORT DATA
            // OCR / AI WILL BE ADDED LATER
            // ===================================

            const passportData = {

                name: "",
                passportNo: "",
                dob: "",
                nationality: ""

            };


            // ===================================
            // RESPONSE
            // ===================================

            return res.json({

                success: true,

                message: "Passport Received",

                data: passportData

            });

        }

        catch (error) {

            console.error(
                "Passport API Error:",
                error
            );

            return res.status(500).json({

                success: false,

                message: "Server Error",

                error: error.message

            });

        }

    }
);


// ===================================
// 404 HANDLER
// ===================================

app.use((req, res) => {

    res.status(404).json({

        success: false,

        message: "API Endpoint Not Found"

    });

});


// ===================================
// SERVER START
// ===================================

// Render automatically provides PORT.
// Local computer will use 3000.

const PORT = process.env.PORT || 3000;


app.listen(
    PORT,
    () => {

        console.log(
            `ARIF VISA API SERVER RUNNING ON PORT ${PORT}`
        );

    }
);