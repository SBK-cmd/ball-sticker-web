
(function () {
  // ---- คลาวด์ (Firebase) สำหรับซิงค์ "บัญชีผู้ใช้งาน" ข้ามเครื่อง/อุปกรณ์ ----
  // สมัคร/ตั้งรหัสผ่านครั้งเดียว ใช้ได้ทุกเครื่องที่เปิดแอปนี้ — ถ้าใช้คลาวด์ไม่ได้ (ออฟไลน์/บล็อกสคริปต์)
  // จะ fallback ไปใช้ข้อมูลในเครื่องนี้ (localStorage) แทนโดยอัตโนมัติ ไม่กระทบการทำงานเดิม
  var firebaseConfig = {
    apiKey: "AIzaSyDgIyeVed6xnG7A8YLRhbvZfxJOoHYpVco",
    authDomain: "ball-sticker-d95c2.firebaseapp.com",
    projectId: "ball-sticker-d95c2",
    storageBucket: "ball-sticker-d95c2.firebasestorage.app",
    messagingSenderId: "646578838963",
    appId: "1:646578838963:web:36984908ecbfd79d183fc6",
    measurementId: "G-D9CNDC6L08"
  };
  var authDb = null;
  try {
    if (typeof firebase !== 'undefined' && firebaseConfig.apiKey) {
      var fbApp = (firebase.apps && firebase.apps.length) ? firebase.apps[0] : firebase.initializeApp(firebaseConfig);
      authDb = firebase.firestore(fbApp);
      // เก็บข้อมูลคลาวด์ไว้ในเครื่อง (IndexedDB) — เปิดแอปใหม่จะแสดงจากเครื่องทันที และถ้ากลับมาภายใน ~30 นาที
      // Firestore จะส่งมาเฉพาะรายการที่เปลี่ยน ไม่ต้องอ่านทั้งคอลเลกชันใหม่ (ประหยัดโควตาอ่านฟรี 50K/วัน)
      try { authDb.enablePersistence({synchronizeTabs: true}).catch(function (e) { console.warn('firestore persistence off', e && e.code); }); } catch (e) {}
      // เข้าสู่ระบบ Firebase แบบไม่ระบุตัวตน (anonymous) ก่อนอ่าน/เขียนข้อมูล — จำเป็นสำหรับกฎความปลอดภัยที่ต้องล็อกอินก่อน
      // ใช้ promise กลางตัวเดียว (window.__bsAuthReady) ให้สคริปต์ส่วนซิงก์ข้อมูลอื่นๆ ในหน้านี้รอได้ด้วย
      if (!window.__bsAuthReady) {
        window.__bsAuthReady = new Promise(function (resolve) {
          var settled = false;
          var done = function () { if (!settled) { settled = true; resolve(); } };
          try {
            var fbAuth = firebase.auth(fbApp);
            fbAuth.onAuthStateChanged(function (user) { if (user) done(); });
            fbAuth.signInAnonymously().catch(function (e) { console.error('firebase anon sign-in failed', e); done(); });
          } catch (e) { done(); }
          setTimeout(done, 7000); // กันค้าง ถ้าล็อกอินไม่ได้ (เช่นยังไม่เปิด Anonymous ใน Firebase console) ให้ไปต่อแบบไม่มีคลาวด์
        });
      }
    }
  } catch (e) { authDb = null; }
  var usersDocRef = authDb ? authDb.collection('bs_meta').doc('users') : null;
  function pushUsersToCloud(list) {
    if (!usersDocRef) return;
    (window.__bsAuthReady || Promise.resolve()).then(function () {
      usersDocRef.set({ list: list, updatedAt: Date.now() }).catch(function (e) { console.error('sync users to cloud failed', e); });
    });
  }
  // ดึงรายชื่อบัญชีล่าสุดจากคลาวด์ครั้งเดียว — คืนค่า null ถ้าใช้คลาวด์ไม่ได้/หลุดเน็ต/ช้าเกินไป (ให้ผู้เรียกใช้ fallback เอง)
  // มี timeout กันเน็ตค้าง (เช่นออฟไลน์แบบไม่มี DNS) ไม่ให้ผู้ใช้ต้องรอหน้า "กำลังตรวจสอบบัญชี..." ค้างตลอดไป
  function fetchCloudUsers() {
    if (!usersDocRef) return Promise.resolve(null);
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 7000); });
    var fetchP = (window.__bsAuthReady || Promise.resolve()).then(function () {
      return usersDocRef.get();
    }).then(function (doc) {
      return doc.exists ? (doc.data().list || []) : [];
    }).catch(function () { return null; });
    return Promise.race([fetchP, timeout]);
  }

  async function hashPassword(password, salt) {
    var input = salt + ':' + password;
    if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
      try {
        var buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      } catch (e) {}
    }
    // เบราว์เซอร์ไม่รองรับ Web Crypto (เช่นไม่ใช่ secure context) — ใช้แฮชสำรองแบบง่าย กันรหัสผ่านโผล่ตรงๆ ในที่เก็บข้อมูล
    var h = 0;
    for (var i = 0; i < input.length; i++) { h = (Math.imul(31, h) + input.charCodeAt(i)) | 0; }
    return 'fb' + (h >>> 0).toString(16);
  }
  function randSalt() {
    var arr = new Uint8Array(16);
    try { window.crypto.getRandomValues(arr); } catch (e) { for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256); }
    return Array.prototype.map.call(arr, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function getUsersLocal() { try { return JSON.parse(localStorage.getItem('bs_users') || '[]'); } catch (e) { return []; } }
  function saveUsersLocal(list) { try { localStorage.setItem('bs_users', JSON.stringify(list)); return true; } catch (e) { return false; } }
  // getUsers/saveUsers: อ่าน/เขียนแคชในเครื่องนี้ทันที (ที่อื่นในแอปเรียกใช้แบบ sync เหมือนเดิมได้) + อัปขึ้นคลาวด์เบื้องหลังให้ทุกเครื่องเห็นบัญชีเดียวกัน
  function getUsers() { return getUsersLocal(); }
  function saveUsers(list) { var ok = saveUsersLocal(list); pushUsersToCloud(list); return ok; }
  // ใช้ localStorage (ไม่ใช่ sessionStorage) เพื่อให้ค้างสถานะล็อกอินไว้ ไม่ต้องเข้าสู่ระบบซ้ำทุกครั้งที่เปิดแอป (การล็อกอินยังแยกเป็นรายเครื่อง)
  function getSession() { try { return JSON.parse(localStorage.getItem('bs_session') || 'null'); } catch (e) { return null; } }
  function setSession(s) { try { localStorage.setItem('bs_session', JSON.stringify(s)); } catch (e) {} }
  function clearSession() { try { localStorage.removeItem('bs_session'); } catch (e) {} }
  // ฟังรายชื่อบัญชีจากคลาวด์แบบเรียลไทม์ (ใช้ให้สิทธิ์ที่ผู้ดูแลแก้จากอีกเครื่องมีผลทันที)
  function watchUsers(cb) {
    if (!usersDocRef) return;
    (window.__bsAuthReady || Promise.resolve()).then(function () {
      usersDocRef.onSnapshot(function (doc) {
        try { if (!doc.metadata.fromCache) { var k='bs_reads_'+(function(d){return d.getFullYear()+''+(d.getMonth()+1)+d.getDate();})(new Date()); localStorage.setItem(k, String((+localStorage.getItem(k)||0)+1)); } } catch (e) {}
        if (!doc.exists) return;
        var list = doc.data().list || [];
        saveUsersLocal(list);
        cb(list);
      }, function (e) { console.error('users watch failed', e); });
    });
  }
  window.BSAuth = {
    getUsers: getUsers, saveUsers: saveUsers, getSession: getSession, setSession: setSession,
    hashPassword: hashPassword, randSalt: randSalt, watchUsers: watchUsers,
    logout: function () { clearSession(); location.reload(); }
  };

  var screen = document.getElementById('lockScreen');
  var users; // ตั้งค่าจริงหลังเช็กคลาวด์เสร็จ (ดู initLockScreen ด้านล่าง)
  var session = getSession();

  var setupView = document.getElementById('lockSetupView');
  var loginView = document.getElementById('lockLoginView');
  var registerView = document.getElementById('lockRegisterView');
  var resetView = document.getElementById('lockResetView');
  var card = document.getElementById('lockCard');

  function showView(view) {
    document.documentElement.classList.remove('bs-nosess');
    [setupView, loginView, registerView, resetView].forEach(function (v) { v.hidden = (v !== view); });
    var firstInput = view.querySelector('input') || view.querySelector('button');
    if (firstInput) setTimeout(function () { firstInput.focus(); }, 30);
  }
  function shake() {
    card.classList.add('shake');
    setTimeout(function () { card.classList.remove('shake'); }, 400);
  }

  // แสดงข้อความระหว่างรอเช็กคลาวด์ ก่อนตัดสินใจว่าจะขึ้นหน้าตั้งค่าบัญชีเจ้าของร้าน หรือหน้าเข้าสู่ระบบ
  var loadingMsg = document.getElementById('lockLoading'); // อยู่ใน HTML เลย — ขึ้นจอได้ทันทีไม่ต้องรอโหลดสคริปต์

  // ---- ตัดสินใจว่าจะขึ้นหน้าไหน: รอผลจากคลาวด์ก่อนเสมอ (ถ้ามีคลาวด์ตั้งค่าไว้และต่อได้) ----
  // สำคัญ: ต้องรอ ไม่ใช่เดาจากแคชเครื่องนี้ก่อนแล้วค่อยสลับทีหลัง เพราะเครื่องใหม่ที่ยังไม่มีแคช
  // อาจโชว์หน้า "ตั้งค่าบัญชีเจ้าของร้าน" ผิดๆ และถ้าพลาดกดสร้างบัญชีไปก่อนคลาวด์ตอบ จะได้บัญชีซ้อนกัน
  (async function initLockScreen() {
    var effectiveUsers = getUsersLocal();
    // ทางลัด: เครื่องนี้เคยล็อกอินไว้แล้วและบัญชียังอยู่ในแคช → เข้าแอปทันที ไม่ต้องรอคลาวด์
    // แล้วค่อยเช็กกับคลาวด์เบื้องหลัง ถ้าบัญชีถูกลบไปแล้วจะออกจากระบบให้เอง
    if (session && effectiveUsers.some(function (u) { return u.id === session.id; })) {
      users = effectiveUsers; loadingMsg.remove(); screen.hidden = true;
      if (usersDocRef) fetchCloudUsers().then(function (cloudList) {
        if (!cloudList) return;
        saveUsersLocal(cloudList); users = cloudList;
        if (!cloudList.some(function (u) { return u.id === session.id; })) { clearSession(); location.reload(); }
      });
      return;
    }
    if (usersDocRef) {
      var cloudList = await fetchCloudUsers();
      if (cloudList) {
        effectiveUsers = cloudList;
        saveUsersLocal(cloudList);
      }
      // cloudList เป็น null แปลว่าใช้คลาวด์ไม่ได้ตอนนี้ (ออฟไลน์/บล็อกสคริปต์ ฯลฯ) — ใช้แคชเครื่องนี้ต่อไปตามที่ตั้งไว้แล้วข้างบน
    }
    users = effectiveUsers;
    loadingMsg.remove();
    document.documentElement.classList.remove('bs-nosess');

    if (session && users.some(function (u) { return u.id === session.id; })) {
      screen.hidden = true;
      return;
    }
    if (session) clearSession(); // เซสชันไม่ตรงกับบัญชีที่มีอยู่ (เช่นถูกลบไปแล้ว) ให้ล้างทิ้ง

    showView(users.length ? loginView : setupView);
  })();

  document.getElementById('lockSetupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = document.getElementById('setupName').value.trim();
    var uname = document.getElementById('setupUser').value.trim();
    var pass = document.getElementById('setupPass').value;
    var pass2 = document.getElementById('setupPass2').value;
    var err = document.getElementById('setupErr');
    if (!name || !uname || !pass) { err.textContent = 'กรอกข้อมูลให้ครบทุกช่อง'; err.hidden = false; shake(); return; }
    if (pass.length < 4) { err.textContent = 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร'; err.hidden = false; shake(); return; }
    if (pass !== pass2) { err.textContent = 'รหัสผ่านยืนยันไม่ตรงกัน'; err.hidden = false; shake(); return; }
    var setupBtn = e.target.querySelector('button[type="submit"]');
    setupBtn.disabled = true;
    // เช็กคลาวด์ก่อนสร้างบัญชีเจ้าของร้าน กันสร้างซ้อนกันถ้ามีคนตั้งค่าจากอีกเครื่องไปพร้อมกัน
    fetchCloudUsers().then(function (cloudList) {
      if (cloudList && cloudList.length) {
        saveUsersLocal(cloudList);
        users = cloudList;
        setupBtn.disabled = false;
        showView(loginView);
        return;
      }
      var salt = randSalt();
      hashPassword(pass, salt).then(function (hash) {
        var user = {id: 'u' + Date.now(), name: name, username: uname, role: 'owner', salt: salt, hash: hash, createdAt: Date.now()};
        saveUsers([user]);
        setSession({id: user.id, name: user.name, username: user.username, role: user.role});
        location.reload();
      });
    });
  });

  document.getElementById('lockLoginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var uname = document.getElementById('loginUser').value.trim();
    var pass = document.getElementById('loginPass').value;
    var err = document.getElementById('loginErr');
    err.hidden = true;
    function findAndCheck(list) {
      var user = list.find(function (u) { return u.username.toLowerCase() === uname.toLowerCase(); });
      if (!user) return Promise.resolve(null);
      return hashPassword(pass, user.salt).then(function (hash) { return hash === user.hash ? user : null; });
    }
    var localList = getUsers();
    findAndCheck(localList).then(function (user) {
      if (user) {
        setSession({id: user.id, name: user.name, username: user.username, role: user.role});
        location.reload();
        return;
      }
      // ไม่เจอในแคชเครื่องนี้ หรือรหัสผ่านไม่ตรง — ถ้ามีคลาวด์ ลองดึงข้อมูลล่าสุดมาเช็กอีกที
      // เผื่อเพิ่งสมัคร/แก้รหัสผ่านจากเครื่องอื่นมา แล้วเครื่องนี้ยังไม่เคยซิงค์
      if (!usersDocRef) { err.hidden = false; shake(); document.getElementById('loginPass').value = ''; document.getElementById('loginPass').focus(); return; }
      fetchCloudUsers().then(function (cloudList) {
        if (!cloudList) return null;
        saveUsersLocal(cloudList);
        return findAndCheck(cloudList);
      }).then(function (user2) {
        if (user2) {
          setSession({id: user2.id, name: user2.name, username: user2.username, role: user2.role});
          location.reload();
        } else {
          err.hidden = false; shake();
          document.getElementById('loginPass').value = '';
          document.getElementById('loginPass').focus();
        }
      }).catch(function () { err.hidden = false; shake(); });
    });
  });

  document.getElementById('lockRegisterBtn').addEventListener('click', function () {
    document.getElementById('regName').value = '';
    document.getElementById('regUser').value = '';
    document.getElementById('regPass').value = '';
    document.getElementById('regPass2').value = '';
    document.getElementById('regErr').hidden = true;
    showView(registerView);
  });
  document.getElementById('lockCancelRegisterBtn').addEventListener('click', function () { showView(loginView); });
  document.getElementById('lockRegisterForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = document.getElementById('regName').value.trim();
    var uname = document.getElementById('regUser').value.trim();
    var pass = document.getElementById('regPass').value;
    var pass2 = document.getElementById('regPass2').value;
    var err = document.getElementById('regErr');
    if (!name || !uname || !pass) { err.textContent = 'กรอกข้อมูลให้ครบทุกช่อง'; err.hidden = false; shake(); return; }
    if (pass.length < 4) { err.textContent = 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร'; err.hidden = false; shake(); return; }
    if (pass !== pass2) { err.textContent = 'รหัสผ่านยืนยันไม่ตรงกัน'; err.hidden = false; shake(); return; }
    var regBtn = e.target.querySelector('button[type="submit"]');
    regBtn.disabled = true;
    fetchCloudUsers().then(function (cloudList) {
      var list = cloudList || getUsers();
      if (cloudList) saveUsersLocal(cloudList);
      if (list.some(function (u) { return u.username.toLowerCase() === uname.toLowerCase(); })) {
        err.textContent = 'มีชื่อผู้ใช้นี้อยู่แล้ว ลองใช้ชื่ออื่น'; err.hidden = false; shake(); regBtn.disabled = false; return;
      }
      var salt = randSalt();
      hashPassword(pass, salt).then(function (hash) {
        var user = {id: 'u' + Date.now(), name: name, username: uname, role: 'staff', salt: salt, hash: hash, createdAt: Date.now()};
        saveUsers(list.concat([user]));
        setSession({id: user.id, name: user.name, username: user.username, role: user.role});
        location.reload();
      });
    });
  });

  document.getElementById('lockForgotBtn').addEventListener('click', function () {
    var shopName = 'บอลสติ๊กเกอร์ พิษณุโลก';
    try { var shop = JSON.parse(localStorage.getItem('bs_shop') || '{}'); if (shop && shop.name) shopName = shop.name; } catch (e) {}
    document.getElementById('resetShopName').textContent = shopName;
    showView(resetView);
  });
  document.getElementById('lockCancelResetBtn').addEventListener('click', function () { showView(loginView); });
})();
