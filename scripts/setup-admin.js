const readline = require("readline");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const qrcode = require("qrcode-terminal");
const speakeasy = require("speakeasy");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise((resolve) => rl.question(question, resolve));
}

(async () => {
    const ownerCode = await ask("Nhập mã chủ sở hữu bạn muốn dùng để đăng nhập admin: ");

    if (!ownerCode || ownerCode.length < 10) {
        console.error("Mã chủ sở hữu nên dài ít nhất 10 ký tự.");
        process.exit(1);
    }

    const hash = await bcrypt.hash(ownerCode, 12);
    const sessionSecret = crypto.randomBytes(48).toString("hex");
    const totpSecret = speakeasy.generateSecret({
        name: "We Viet Admin",
        issuer: "We Viet"
    });

    console.log("\nQuét QR này bằng Google Authenticator, Microsoft Authenticator hoặc 1Password:");
    qrcode.generate(totpSecret.otpauth_url, { small: true });

    console.log("\nDán các giá trị sau vào biến môi trường trên server/hosting:");
    console.log(`SESSION_SECRET=${sessionSecret}`);
    console.log(`ADMIN_CODE_HASH=${hash}`);
    console.log(`TOTP_SECRET=${totpSecret.base32}`);
    console.log("\nKhông commit các giá trị này lên GitHub.");
    rl.close();
})();
