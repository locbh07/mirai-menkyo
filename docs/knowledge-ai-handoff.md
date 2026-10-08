# Bộ Bàn Giao Kiến Thức Mirai Menkyo

## Gửi Cho AI

Gửi ZIP của bộ này và nội dung `PROMPT-CHO-MUSE.md`. Bản xuất mặc định dùng `vi`;
các ngôn ngữ khác có thể xuất riêng bằng `--locale en`, `zh-Hans`, `zh-Hant`, `pt`.
`bundle.json` ghi ngôn ngữ và số lượng thực tế, không cần sửa tay.

Chưa dịch tự động và chưa dùng API trả phí. Bản gốc tiếng Nhật 2024 không thay đổi.
Manifest xuất hiện tại gồm 151/277 hình tham khảo chuẩn/màu từ MLIT và Wikimedia
Commons; một số biển phụ theo chuẩn vẫn trắng đen. Không phải toàn bộ PDF đã được
tô màu. Mọi hình gốc vẫn được giữ để đối chiếu.

## Các File

- `bundle.json`: danh sách unit có hash và cấu trúc trình bày từng bài/bảng/ô/hình.
- `batch-index.json`: thứ tự 71 bài và tên file đầu vào/mẫu trả về.
- `pilot-index.json`: hai bài đề nghị dịch thử (nội dung thân bài và bảng biển cảnh báo).
- `lessons/*.source.json`: dữ liệu một bài, ngữ cảnh đoạn và ảnh liên quan.
- `lessons/*.source.md`: bản dễ đọc, bảng HTML giữ rowspan/colspan và chú thích ID.
- `return-templates/*.json`: mẫu bản dịch từng bài, mặc định pending/null.
- `return-templates/image-plan.json`: phương án ảnh, không phải lệnh thay ảnh.
- `return-templates/glossary.json`: bảng thuật ngữ đề xuất.
- `images-manifest.json`: 277 vị trí ảnh, bản gốc, bản màu, tên ô và nguồn.
- `media/original`: đủ 277 ảnh gốc, đặt tên bằng image ID để AI dễ tìm.
- `media/color`: các hình tham khảo đang áp dụng theo manifest. `media/tables`: 87 ảnh bảng gốc theo trang.
- `reference`: PDF gốc, PDF màu MLIT và JSON nguồn có audit ID.
- `asset-integrity.json`: hash các tài sản bàn giao. `proposed-images`: ảnh ứng viên mới.
- `index.html`: màn hình duyệt song ngữ chạy offline, không gửi dữ liệu ra dịch vụ.

Mở `index.html` trong thư mục đã giải nén. File HTML dùng JS/ảnh/font cạnh nó;
không chỉ mở riêng một HTML tách khỏi bộ. Dùng “Mở bản dịch” để chọn các file JSON
AI trả về. Desktop hiển thị Nhật/bản dịch cạnh nhau; mobile xếp dọc. Có xem hình
lớn, chọn ảnh màu/gốc, tham chiếu “như trên” và xem mảnh bảng PDF. Bản chưa dịch
giữ nguyên tiếng Nhật, bản cần kiểm tra được đánh dấu. Không coi đây là bản đã duyệt.

## Quy Trình Duyệt

1. Dịch thử bài thân nội dung và bài có bảng/hình; thống nhất thuật ngữ trước.
2. Dịch từng bài hoặc từng lô unit của bài dài. Không để AI trả một HTML mới.
3. Lưu kết quả trong bộ đã giải nén, ví dụ `returned/`; không ghi đè `.source.json`.
4. Kiểm tra cấu trúc bằng lệnh dưới đây. Bản từng lô được phép chưa đủ; `--complete`
   chỉ dùng khi đã hợp nhất mọi bài. Chỉ load file đã trả về, không trộn mẫu pending
   với bản hoàn thành có các unit chương dùng chung khác nội dung/trạng thái.
5. Kiểm tra số liệu, thuật ngữ, phủ định/ngoại lệ và tất cả ảnh ứng viên bằng người
   có thể đọc Nhật. Kiểm tra kỹ `needs_review` và cảnh báo số/nhãn sơ đồ.
6. Gửi lại bộ JSON + image plan + file ứng viên cho người làm web. Bước import vào
   runtime/xuất bản sẽ làm sau khi duyệt, chưa có trong lệnh kiểm tra này.

Chạy từ repo `C:\Users\locbh\mirai-menkyo`:

```powershell
npm run export:knowledge-handoff -- --locale vi
node scripts/validate-knowledge-handoff.mjs "DUONG_DAN_BO_DA_GIAI_NEN" "DUONG_DAN_BAN_DICH.json"
node scripts/validate-knowledge-handoff.mjs "DUONG_DAN_BO_DA_GIAI_NEN" "DUONG_DAN_BAN_DICH.json" "DUONG_DAN_IMAGE_PLAN.json" --complete
```

Validator kiểm tra ID, hash nguồn, trùng/xung đột, trạng thái, tiêu đề trùng,
coverage khi complete, hash ảnh gốc/ứng viên và đường dẫn an toàn. Chênh lệch số
hoặc chữ A/B/C/D là cảnh báo cần người xem, không phải tự động sửa. `translated`
không có nghĩa chính xác hoặc đủ điều kiện xuất bản. Báo cáo luôn ghi chưa publish.
Ảnh ứng viên có hash đúng vẫn có thể sai nội dung hoặc quyền dùng; SVG cần
sanitize riêng trước khi đưa lên website. Preview không chạy ứng viên SVG đó.

## Hợp Đồng Cho Web

Giữ riêng ba lớp: nguồn JA không sửa, bản dịch theo unit ID, tài sản/chú thích hình.
`packageId` ràng buộc đúng phiên bản layout + chữ + ảnh + ngôn ngữ đích. Hash của
unit ràng buộc đúng nguyên văn. Bản dịch của một bộ không áp dụng lên bộ nguồn khác.

Một bài dùng `titleUnit`, tên chương dùng `group.titleUnit`. Các block text dùng
`unitId`; khoảng trắng thuần được giữ ở `literal`, không yêu cầu dịch. Một bảng có
`rows`, `columns`, `hasHeader`, `cells`. Mỗi cell giữ row/column, rowspan/colspan,
`reference`, và danh sách `content` xen kẽ chữ/hình. Không dựng lại layout bằng
phỏng đoán từ văn bản đã dịch. `sourceCells` truy nguyên các ô nối từ trang PDF.

Một image ID là một vị trí trong tài liệu, không nhất thiết một file ảnh độc nhất
hoặc một loại biển báo duy nhất. Alt dùng để truy cập; chữ nằm trong raster cần
inventory riêng, không được coi là đã dịch khi chỉ dịch alt.

Web chính nên hiển thị bài đã được người duyệt chấp nhận theo ngôn ngữ nội dung,
không tự trộn câu Nhật và câu Việt trong bản chính. Bản nháp/song ngữ nằm ở màn
duyệt riêng. Ảnh dùng chung, trỏ lại ID nguồn; ảnh ứng viên chỉ được áp dụng sau
đối chiếu và chấp nhận rõ ràng. Bản gốc/PDF/fallback luôn giữ lại.

Bố cục: một H1, H2/H3 theo nguồn, đoạn dễ đọc, hình đúng tỷ lệ và vị trí chú thích.
Bảng đơn giản reflow trên điện thoại, bảng gộp phức tạp cuộn trong vùng riêng.
Không đổi các ô chung thành nội dung riêng, không lặp H1 và không thay bảng hai
cặp loại/màu bằng bảng bốn cột loại/số/ý nghĩa/màu. Không cố định chiều cao đoạn.

Web chính đã tích hợp bản Việt do người dùng cung cấp, với lớp hiệu chỉnh riêng
để không lặp ô bảng và giữ thứ tự chú thích/hình. Bộ xuất tiếp theo vẫn là công
cụ duyệt bản nháp cho ngôn ngữ mới, không tự xuất bản nội dung hoặc ảnh trả về.
