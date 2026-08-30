# VAST — Kế hoạch triển khai VPS và thương mại hóa

> Cập nhật: 29/08/2026
> Trạng thái: **Kế hoạch đã thống nhất, chưa triển khai production**

Tài liệu này là nguồn tham chiếu chính khi đưa VAST lên Internet. Khi bắt đầu triển khai, đọc tài liệu này trước rồi đối chiếu lại mã nguồn hiện tại, không dựa vào trí nhớ hoặc các bản sao cũ ngoài thư mục `vietnamaismart-main`.

---

## 1. Quyết định kiến trúc

Giai đoạn thi khởi nghiệp và chạy thử tại một số ao sẽ dùng:

- **VPS Linux riêng** đặt tại TP.HCM hoặc Singapore.
- **Ubuntu LTS**.
- **Node.js bản LTS** để chạy backend VAST.
- **Docker Compose** để đóng gói và khởi động đồng nhất.
- **Caddy** làm reverse proxy và tự quản lý HTTPS.
- **Tên miền riêng**, ví dụ `app.tenmien.vn`.
- **Cloudflare DNS**; có thể bật proxy sau khi kiểm thử ESP32 và SSE.
- **SQLite trên persistent volume** trong giai đoạn thi/pilot.
- **Sao lưu database hằng ngày sang nơi khác VPS**.
- Chuyển sang **PostgreSQL** khi phục vụ nhiều trang trại hoặc cần nhiều máy chủ.

Không tách frontend và backend ở giai đoạn đầu. Node.js tiếp tục phục vụ cả website và API trên cùng một tên miền để giảm lỗi CORS, cấu hình và vận hành.

```text
ESP32 tại ao ── HTTPS ──┐
Điện thoại/Web ─ HTTPS ─┼── Tên miền / Cloudflare DNS
                        ↓
                  Caddy (443/HTTPS)
                        ↓
              Node.js VAST (127.0.0.1:3000)
                        ↓
             SQLite persistent volume
                        ↓
                Bản sao lưu ngoài VPS
```

---

## 2. Cấu hình VPS khuyến nghị

### Đi thi và pilot

- 1–2 vCPU.
- RAM **2 GB**.
- SSD/NVMe 40–50 GB.
- Một IPv4 công khai.
- Snapshot hoặc backup do nhà cung cấp hỗ trợ.
- Vị trí TP.HCM hoặc Singapore.

Máy 1 GB có thể chạy được, nhưng 2 GB an toàn hơn khi vừa chạy Node.js, Caddy, Docker, sao lưu và giám sát.

### Khi đã có khách hàng

- Tăng lên 2 vCPU, RAM 4 GB nếu lưu nhiều lịch sử hoặc nhiều thiết bị.
- Tách PostgreSQL thành dịch vụ riêng hoặc dùng managed database.
- Có staging server để thử bản mới trước khi cập nhật production.

Không chọn hosting PHP/shared hosting vì VAST cần Node.js chạy liên tục, SSE realtime, database ghi liên tục và kết nối ESP32 24/7.

---

## 3. Không được public mã nguồn hiện tại ngay

Trước khi mở cổng Internet phải hoàn thành kiểm tra bảo mật. Hiện một số API IoT và máy cho ăn chưa buộc phiên đăng nhập/người sở hữu ao. Nếu public nguyên trạng, người biết endpoint có thể đọc dữ liệu hoặc tạo lệnh điều khiển.

### Nhóm API cần khóa và phân quyền

Ít nhất phải rà lại:

- `POST /api/iot/command`
- `GET /api/iot/latest`
- `GET /api/iot/stream`
- `GET /api/iot/history/:deviceId`
- Toàn bộ `POST /api/feed/*`
- API cài đặt, nhật ký, ao, thu chi và cố vấn có dữ liệu riêng của người dùng

Nguyên tắc:

1. Trình duyệt phải có phiên đăng nhập hợp lệ.
2. Người dùng chỉ được xem/điều khiển ao thuộc tài khoản của mình.
3. ESP32 chỉ dùng `X-Device-Token` cho ba luồng thiết bị: telemetry, lấy lệnh và ACK.
4. API truy xuất nguồn gốc QR được công khai có chủ đích, nhưng chỉ trả dữ liệu đã chọn để công khai.
5. Mọi lệnh điều khiển phải ghi audit log: ai, ao nào, lệnh gì, lúc nào và thiết bị đã ACK chưa.

### Việc bảo mật bắt buộc

- Bỏ CORS `*`; chỉ cho phép tên miền production và địa chỉ development đã khai báo.
- Thêm rate limit cho đăng nhập, API điều khiển và endpoint công khai.
- Giới hạn kích thước request body.
- Đưa token/mật khẩu/cấu hình nhạy cảm vào biến môi trường hoặc secret của VPS.
- Không commit `firmware/esp32_vast/config.h`, `server/config.json`, database hay file `.env`.
- Đổi toàn bộ device token trước ngày chạy production.
- Bật firewall; chỉ mở SSH có giới hạn, HTTP 80 và HTTPS 443.
- Tắt đăng nhập SSH bằng mật khẩu sau khi đã cài SSH key.
- Cập nhật hệ điều hành và Node.js định kỳ.

---

## 4. Việc cần sửa trong dự án trước khi đóng gói

### Backend

- Sửa `server/package.json`; các script hiện còn trỏ tới tên file cũ như `server.js`, `seed.js` và `simulate_esp32.js`.
- Chuẩn hóa lệnh production thành `node index.js`.
- Thêm đường dẫn database qua biến môi trường, ví dụ `VAST_DATA_DIR=/app/data`.
- Bảo đảm SQLite, file WAL và dữ liệu tải lên đều nằm trong persistent volume.
- Thêm shutdown an toàn khi container nhận `SIGTERM`.
- Thêm middleware xác thực/phân quyền cho API nguy hiểm.
- Thêm security headers, rate limit và access log phù hợp.
- Giữ `/api/health` nhẹ và không trả thông tin bí mật.

### Frontend

- Dùng cùng origin với backend; `VAST_CONFIG.API_BASE` để trống trên production.
- Bỏ hoặc tải nội bộ Tailwind, Alpine, HTMX, Chart.js và Lucide nếu muốn hệ thống hoạt động khi Internet quốc tế chập chờn.
- Không đặt token thiết bị ESP32 trong JavaScript hoặc HTML.
- Xem xét chuyển session từ localStorage sang cookie `HttpOnly`, `Secure`, `SameSite` trước khi thương mại rộng.

### Firmware ESP32

- Đổi `SERVER_URL` từ IP/HTTP sang tên miền HTTPS, ví dụ `https://app.tenmien.vn`.
- Dùng `WiFiClientSecure` và xác thực CA/chứng chỉ đúng cách.
- **Không dùng `setInsecure()` trong bản thương mại**.
- Giữ logic AUTO và fail-safe trên ESP32; không chuyển logic an toàn lên VPS.
- Có cách đổi Wi-Fi, server URL và device token mà không phải sửa nhầm mã nguồn chung.
- Chuẩn bị quy trình cập nhật firmware có phiên bản và khả năng quay lại bản trước.

---

## 5. Các file triển khai cần tạo

Khi bắt đầu thực hiện kế hoạch, dự kiến thêm:

```text
vietnamaismart-main/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── deploy-staging.yml
│       └── deploy-production.yml
├── Dockerfile
├── docker-compose.yml
├── Caddyfile
├── .dockerignore
├── .env.example
├── deploy/
│   ├── backup.sh
│   ├── restore.sh
│   ├── healthcheck.sh
│   └── vast.service          # chỉ cần nếu không dùng Docker Compose
└── docs/
    ├── HUONG_DAN_DEPLOY_VPS.md
    ├── HUONG_DAN_BACKUP_KHOI_PHUC.md
    └── KE_HOACH_TRIEN_KHAI_THUONG_MAI.md
```

Không tạo file `.env` thật trong Git. Chỉ lưu `.env.example` với tên biến và giá trị giả.

---

## 6. Cấu hình production dự kiến

Ví dụ tên biến môi trường, chưa phải secret thật:

```dotenv
NODE_ENV=production
PORT=3000
PUBLIC_URL=https://app.tenmien.vn
VAST_DATA_DIR=/app/data
DEVICE_OFFLINE_SECONDS=20
HISTORY_SAMPLE_SECONDS=10
MARKET_REFRESH_MINUTES=30
MARKET_ADMIN_TOKEN=THAY_BANG_CHUOI_NGAU_NHIEN_DAI
SESSION_SECRET=THAY_BANG_CHUOI_NGAU_NHIEN_DAI
ALLOWED_ORIGINS=https://app.tenmien.vn
RESEND_API_KEY=re_THAY_BANG_KHOA_API_TREN_VPS
EMAIL_FROM=VAST <no-reply@tenmien.vn>
```

Container Node chỉ lắng nghe trong mạng Docker hoặc `127.0.0.1`. Chỉ Caddy được nhận lưu lượng công khai trên cổng 80/443.

Caddy dự kiến reverse proxy toàn bộ tên miền vào Node.js và tự cấp/gia hạn chứng chỉ HTTPS.

### Email OTP lấy lại mật khẩu

- Tài khoản đăng ký mới phải có email; tài khoản cũ bổ sung email trong **Chỉnh sửa hồ sơ**.
- Production gửi mã OTP 6 số bằng Resend qua `RESEND_API_KEY` và `EMAIL_FROM`. Cần xác minh tên miền gửi trong Resend trước khi sử dụng địa chỉ `no-reply@tenmien.vn`.
- Chỉ đặt khóa API trong biến môi trường trên VPS; tuyệt đối không ghi khóa thật vào Git, HTML hoặc JavaScript phía trình duyệt.
- Khi chạy development mà chưa cấu hình Resend, mã OTP được in trong terminal của server để kiểm thử. Khi `NODE_ENV=production`, thiếu cấu hình email sẽ trả lỗi và không giả vờ đã gửi.
- Gói miễn phí phù hợp giai đoạn cuộc thi với lượng email thấp. Khi tăng người dùng, theo dõi giới hạn gửi và chi phí trên trang giá chính thức của Resend: <https://resend.com/pricing>.
- API gửi email đang dùng trực tiếp qua HTTPS theo tài liệu chính thức: <https://resend.com/docs/api-reference/emails/send-email>.

---

## 7. Database và sao lưu

### Giai đoạn SQLite

SQLite phù hợp khi:

- Một VPS chạy một instance VAST.
- Số thiết bị và người dùng còn ít.
- Muốn triển khai nhanh cho cuộc thi và pilot.

Yêu cầu:

- File database phải nằm trên volume bền vững, không nằm trong lớp filesystem tạm của container.
- Backup phải nhất quán với WAL; không sao chép tùy tiện chỉ mỗi `vast.db` trong lúc server đang ghi.
- Chạy backup hằng ngày.
- Giữ nhiều mốc: 7 bản hằng ngày, 4 bản hằng tuần và 6 bản hằng tháng.
- Mã hóa bản sao lưu và đẩy sang máy/object storage khác VPS.
- Mỗi tháng phải thử khôi phục thật vào một thư mục/server kiểm tra.

### Khi chuyển PostgreSQL

Chuyển khi có một trong các dấu hiệu:

- Nhiều trang trại/khách hàng dùng đồng thời.
- Cần nhiều instance backend hoặc high availability.
- Cần báo cáo phức tạp, phân vùng dữ liệu và backup theo chuẩn doanh nghiệp.
- SQLite trở thành điểm nghẽn vận hành hoặc không đáp ứng yêu cầu phục hồi.

Không chuyển chỉ để “trông chuyên nghiệp”; chuyển khi nhu cầu vận hành thực tế xuất hiện.

---

## 8. CI/CD và coding agent tự sửa lỗi

VAST sẽ áp dụng CI/CD trước khi triển khai production. Coding agent có thể đọc log CI, sửa lỗi trên nhánh đang làm và push lại để CI chạy lại, nhưng **không được tự đẩy thẳng vào `main` hoặc tự quyết định đưa bản sửa lên production**.

Luồng đã thống nhất:

```text
Lập trình viên / Agent tạo nhánh feature
                ↓
          Mở Pull Request
                ↓
 CI: syntax + test + security + Docker build
          ↓ fail                 ↓ pass
 Agent đọc log, sửa trên nhánh   Người duyệt mã
 và push lại (tối đa vài vòng)        ↓
          └──────── CI chạy lại ──→ Merge main
                                         ↓
                                  Deploy STAGING
                                         ↓
                              Smoke test + ESP32 giả lập
                                         ↓
                              Người có quyền phê duyệt
                                         ↓
                                Deploy PRODUCTION
                                         ↓
                              Health check / rollback
```

### CI phải kiểm tra gì

- Cú pháp toàn bộ JavaScript.
- Unit test cho công thức thức ăn, giá thị trường, xác thực và phân quyền.
- Integration test API bằng database tạm, không dùng database production.
- Kiểm tra người dùng không truy cập được ao của tài khoản khác.
- Kiểm tra API điều khiển từ người chưa đăng nhập trả 401/403.
- Kiểm tra secret/token không bị commit.
- Build Docker image thành công.
- Kiểm tra health endpoint.
- Biên dịch firmware ESP32 với `config.example.h` hoặc cấu hình CI giả, tuyệt đối không đưa Wi-Fi/token thật vào CI.

### Quy tắc cho coding agent

- Agent chỉ được push vào nhánh của Pull Request.
- Nhánh `main` phải được bảo vệ, cấm push trực tiếp và force-push.
- Mọi commit mới của agent làm mất hiệu lực lượt duyệt cũ; phải CI và duyệt lại.
- Agent không được có SSH key VPS hoặc secret production.
- Giới hạn số vòng tự sửa để tránh lặp vô hạn và tiêu tốn tài nguyên.
- Nếu cùng một lỗi lặp lại hoặc test không đủ rõ, dừng và yêu cầu người xem xét.
- Luôn lưu log: agent sửa file nào, vì lỗi CI nào và test nào đã chạy lại.

### Phần không được tự động hoàn toàn

Các thay đổi sau bắt buộc người có chuyên môn xem và phê duyệt:

- Ngưỡng DO/nhiệt độ và logic AUTO.
- Điều khiển relay, motor máy cho ăn và fail-safe.
- Xác thực, phân quyền và quản lý device token.
- Migration hoặc thao tác có thể làm mất database.
- Cấu hình backup/restore.
- Firmware được nạp lên thiết bị ngoài ao.
- Deploy production và rollback trong giai đoạn thi/pilot.

### Điều kiện triển khai

- CI đỏ: không merge, không deploy.
- CI xanh: chỉ có nghĩa **các kiểm tra đã viết đều đạt**, không có nghĩa chắc chắn không còn lỗi.
- Merge vào `main`: tự động deploy staging.
- Staging đạt smoke test: chờ một người phê duyệt production.
- Production lỗi health check: tự dừng hoặc rollback về image/tag trước.

Trong giai đoạn đầu, chọn **tự động kiểm tra và tự động deploy staging, nhưng production phải bấm duyệt thủ công**. Khi hệ thống và bộ test đủ trưởng thành mới cân nhắc tự động hóa thêm.

---

## 9. Quy trình triển khai dự kiến

### Giai đoạn A — Chuẩn bị mã nguồn

1. Hoàn thành phân quyền API.
2. Sửa package scripts và cấu hình dữ liệu.
3. Tạo Dockerfile, Compose, Caddyfile và `.env.example`.
4. Viết script backup/restore.
5. Thêm test cho đăng nhập, quyền ao, lệnh IoT, máy cho ăn và QR công khai.
6. Kiểm thử firmware HTTPS.

### Giai đoạn B — Staging

1. Tạo VPS thử nghiệm hoặc subdomain `staging.tenmien.vn`.
2. Dùng database và device token riêng, không dùng dữ liệu production.
3. Chạy giả lập ESP32 trước.
4. Kiểm thử SSE realtime, gửi lệnh, ACK, mất mạng và fail-safe.
5. Kiểm thử trên điện thoại 4G/5G ngoài mạng Wi-Fi của VPS.
6. Kiểm thử backup và restore.

### Giai đoạn C — Production

1. Mua VPS và tên miền.
2. Tạo SSH key, firewall và user deploy không phải root.
3. Cài Docker Engine/Compose và Caddy theo phương án đã chốt.
4. Clone repository private vào VPS.
5. Tạo `.env` production trực tiếp trên VPS.
6. Gắn persistent volume cho dữ liệu.
7. Trỏ DNS về VPS và bật HTTPS.
8. Chạy health check.
9. Nạp firmware HTTPS với token production lên ESP32 thử nghiệm.
10. Chỉ sau khi thử ổn định mới chuyển thiết bị ngoài ao.

### Giai đoạn D — Vận hành

- Theo dõi uptime, CPU, RAM, ổ đĩa, lỗi HTTP và thiết bị offline.
- Nhận cảnh báo khi server chết, backup thất bại hoặc ổ đĩa gần đầy.
- Deploy qua Git tag/release; không sửa trực tiếp file trên production.
- Có lệnh rollback về image/tag trước.
- Ghi nhật ký thay đổi sau mỗi lần triển khai.

---

## 10. Tiêu chí đạt trước khi đưa ra ao thật

- [ ] Website chỉ truy cập qua HTTPS hợp lệ.
- [ ] ESP32 xác thực HTTPS và gửi telemetry ổn định.
- [ ] Người dùng A không xem hoặc điều khiển được ao của người dùng B.
- [ ] API điều khiển từ người chưa đăng nhập trả về 401/403.
- [ ] Lệnh web → server → ESP32 → ACK → trạng thái thật hoạt động.
- [ ] Mất Internet không làm hỏng logic AUTO tại ao.
- [ ] MANUAL mất server đủ thời gian sẽ tự về AUTO.
- [ ] Server/container tự khởi động lại sau khi VPS reboot.
- [ ] Database còn nguyên sau deploy/restart container.
- [ ] Backup tự chạy và đã thử restore thành công.
- [ ] Token/config nhạy cảm không xuất hiện trong Git hoặc frontend.
- [ ] Nhánh `main` được bảo vệ và không cho merge khi CI thất bại.
- [ ] Agent chỉ sửa trên nhánh PR, không có secret production.
- [ ] Staging tự động nhưng production yêu cầu phê duyệt thủ công.
- [ ] Có người chịu trách nhiệm nhận cảnh báo và xử lý sự cố.

---

## 11. Lộ trình thương mại hóa

### Mức 1 — Cuộc thi

- Một VPS 2 GB.
- SQLite + backup.
- Một tên miền HTTPS.
- Một hoặc vài ESP32 demo/pilot.
- Giả lập ESP32 làm phương án dự phòng khi phần cứng gặp sự cố tại sân thi.

### Mức 2 — Pilot trang trại

- Phân quyền chủ trại/nhân viên.
- Audit log đầy đủ.
- Giám sát và cảnh báo 24/7.
- Quy trình thay thiết bị, đổi token và cập nhật firmware.
- Điều khoản sử dụng và chính sách bảo mật dữ liệu.

### Mức 3 — Nhiều khách hàng

- PostgreSQL.
- Tách tenant/trang trại rõ ràng.
- Staging và production riêng.
- CI/CD, migration có kiểm soát và rollback.
- Quản lý phiên bản firmware/thiết bị từ xa.
- Máy chủ/database dự phòng và mục tiêu phục hồi cụ thể.

---

## 12. Các nguồn kỹ thuật tham khảo

- Node.js release/LTS: <https://nodejs.org/en/about/previous-releases>
- Node.js SQLite: <https://nodejs.org/api/sqlite.html>
- Caddy Automatic HTTPS: <https://caddyserver.com/docs/automatic-https>
- Caddy reverse proxy: <https://caddyserver.com/docs/caddyfile/directives/reverse_proxy>
- Cloudflare Tunnel: <https://developers.cloudflare.com/tunnel/>
- Cloudflare Quick Tunnel chỉ dành cho thử nghiệm: <https://developers.cloudflare.com/tunnel/setup/>
- Ubuntu release cycle: <https://ubuntu.com/about/release-cycle>
- DigitalOcean Droplet pricing: <https://www.digitalocean.com/pricing/droplets>
- Railway pricing: <https://railway.com/pricing>
- Render persistent disk: <https://render.com/docs/disks>
- GitHub protected branches và required status checks: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>
- GitHub status checks: <https://docs.github.com/en/enterprise-cloud@latest/pull-requests/reference/status-checks>
- GitHub review đầu ra coding agent: <https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/review-copilot-output>
- GitLab protected environments/deployment approvals: <https://docs.gitlab.com/ci/environments/protected_environments/>

---

## 13. Quyết định ngắn gọn để lần sau tiếp tục

Nếu người dùng yêu cầu “triển khai VAST”, thực hiện theo thứ tự:

1. **Không mua VPS ngay nếu API điều khiển chưa được khóa.**
2. Audit và sửa bảo mật trong mã nguồn.
3. Chuẩn bị CI/CD, Docker/Caddy/backup/HTTPS firmware.
4. Bảo vệ nhánh `main`; agent chỉ được sửa qua Pull Request.
5. Test staging bằng giả lập và ESP32 thật.
6. Sau đó mới mua VPS, tên miền và đưa production lên mạng có bước duyệt thủ công.

Phương án mặc định đã chốt: **VPS 2 GB + Ubuntu LTS + Docker Compose + Caddy + HTTPS + tên miền + SQLite persistent volume và backup**, rồi chuyển PostgreSQL khi có nhiều trang trại.
