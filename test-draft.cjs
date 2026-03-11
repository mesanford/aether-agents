const { google } = require("googleapis");
const Database = require("better-sqlite3");

async function testDraft() {
    const db = new Database("crm.db");
    const user = db.prepare("SELECT * FROM google_tokens LIMIT 1").get();

    if (!user) {
        console.log("No user found.");
        return;
    }

    const client = new google.auth.OAuth2();
    client.setCredentials({
        access_token: user.access_token,
        refresh_token: user.refresh_token,
        expiry_date: user.expiry_date,
    });

    const gmail = google.gmail({ version: "v1", auth: client });

    const messageParts = [
        `To: test@example.com`,
        `Subject: Test Draft`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        "This is a test draft body.",
    ];
    const message = messageParts.join("\n");
    const encodedMessage = Buffer.from(message)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    try {
        const res = await gmail.users.drafts.create({
            userId: "me",
            requestBody: {
                message: {
                    raw: encodedMessage,
                },
            },
        });
        console.log("Success! Draft ID:", res.data.id);
    } catch (error) {
        console.error("Error creating draft:", error.message);
        if (error.response && error.response.data) {
            console.error("Detailed error:", JSON.stringify(error.response.data, null, 2));
        }
    }
}

testDraft().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
