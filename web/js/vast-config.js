/* ================================================================
   vast-config.js - Cau hinh ket noi cua PHAN WEB (frontend)
   ----------------------------------------------------------------
   O day KHONG chua mat khau / token gi ca.
   device_token cua ESP32 nam trong database o server, khong bao gio
   duoc gui ra trinh duyet.
   ================================================================ */

window.VAST_CONFIG = {

    /* Dia chi backend.
       - De TRONG ('') neu ban mo web bang chinh server Node
         (http://localhost:3000/dashboard.html)  <-- KHUYEN DUNG
       - Neu ban mo bang Live Server cua VS Code (port 5500) hoac
         mo bang dien thoai, hay dien day du, vi du:
             API_BASE: 'http://192.168.1.10:3000'
    */
    API_BASE: '',

    /* Bao lau lay du lieu realtime 1 lan (mili giay).
       ESP32 gui 3-5s/lan nen 2000ms la du muot. */
    POLL_MS: 2000,

    /* Sau bao lau khong thay ESP32 xac nhan lenh thi bao loi (mili giay). */
    COMMAND_TIMEOUT_MS: 15000,
};
