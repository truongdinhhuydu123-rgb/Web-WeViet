# We Viet Website Backend

Dự án này đã có backend Node.js để nhận yêu cầu báo giá và trang admin bảo vệ bằng mã chủ sở hữu + mã 6 số từ Authenticator.

## Chạy local

```bash
npm install
npm run setup:admin
```

Tạo file `.env` từ `.env.example`, rồi dán các giá trị `SESSION_SECRET`, `ADMIN_CODE_HASH`, `TOTP_SECRET` mà script tạo ra.

```bash
npm start
```

Mở:

- Website: `http://localhost:3000`
- Admin: `http://localhost:3000/admin`

## Bảo mật

Không commit file `.env`, thư mục `data/`, hoặc database khách hàng lên GitHub.

Admin cần 2 lớp:

1. Mã chủ sở hữu bạn tự đặt.
2. Mã 6 số trong Google Authenticator / Microsoft Authenticator / 1Password.

## Deploy chịu tải tốt hơn

Với mục tiêu khoảng 1000 người truy cập, nên deploy backend lên Render, Railway, Fly.io hoặc VPS. Cấu hình tối thiểu nên có:

- Node.js 20+
- HTTPS bật sẵn
- 512MB RAM trở lên cho web nhỏ
- Environment variables từ `.env.example`
- Dùng PostgreSQL qua `DATABASE_URL` khi deploy production

Nếu chưa có `DATABASE_URL`, backend sẽ lưu local vào `data/quote-requests.jsonl` để test. Khi chạy thật cho khách, nên dùng PostgreSQL để ổn định và dễ backup.

