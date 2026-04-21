# Perkloom - Yapilacaklar Listesi

## Uygulama Kimligi ve Temel Prensipler
- Bu uygulama bir OYUN icin tasarlanmis ozel bir skill tree editoru
- Genel amacli bir not uygulamasi, diagram araci veya metin tabanli JSON editoru DEGILDIR
- Temel fikir: buyuk bir skill tree'yi canvas uzerinde gorsel olarak insa et, duzenle, organize et
  ve sonra yapiyi temiz metin olarak disari aktar (baska bir AI'a vermek icin)
- Zihinsel model: koklu agac editoru (rooted tree editor), genel graf editoru DEGIL
  - Varsayilan: her node'un tek parent'i vardir veya root'tur
  - Multi-parent gelecekte opsiyonel ayar olarak eklenebilir
  - Veri modeli buna izin verecek sekilde tasarlanir ama MVP davranisi kirletilmez
- Gorsel-ilk (visual-first) yaklasim: metin ciktisi bir SONUC, birincil is akisi degil
- Asiri muhendislik yapma, net/moduler/pratik mimari, artan gelistirme

---

## Temel MVP Ozellikleri Kontrol Listesi (17 madde)
- [ ] 1. Buyuk canvas
- [ ] 2. Zoom in / zoom out
- [ ] 3. Pan (gezinme)
- [ ] 4. Node olusturma
- [ ] 5. Node silme
- [ ] 6. Node secme
- [ ] 7. Node basligi duzenleme
- [ ] 8. Node aciklamasi duzenleme
- [ ] 9. Node'lari parent-child iliskisiyle baglama
- [ ] 10. Temiz egri baglanti cizgileri
- [ ] 11. Node surukleme
- [ ] 12. Yerel kaydetme
- [ ] 13. Yerel yukleme
- [ ] 14. Undo / Redo
- [ ] 15. JSON export
- [ ] 16. Markdown export
- [ ] 17. Iki etkilesim modu (Static Mode + Responsive Mode)

---

## ASAMA 1: Proje Kurulumu ve Iskele

### 1.1 Proje Olusturma
- Tauri + React + TypeScript proje iskeleti olusturma
- Temel bagimliliklar ve konfigurasyonlar (package.json, tsconfig, tauri.conf.json)
- Projenin calistigini dogrulama (bos pencere acilmali)

### 1.2 Dizin Yapisi ve Mimari Katmanlar
- Proje dizin yapisi ve modul organizasyonu olusturma
- 9 mimari katmani dosya/klasor yapisina yansitma:
  1. App shell / masaustu entegrasyonu (Tauri pencere yonetimi)
  2. Canvas rendering katmani (React component'leri)
  3. Graph state/data katmani (agac veri yapisi, state yonetimi)
  4. Interaction katmani (mouse/keyboard olaylari)
  5. Mode behavior katmani (Static/Responsive mod mantigi)
  6. Physics / layout response katmani (fizik simulasyonu)
  7. Persistence katmani (dosya okuma/yazma)
  8. Undo/redo history katmani (islem gecmisi)
  9. Export katmani (JSON/Markdown cikti)
- Acik ve anlasilir mantik, agir soyutlama degil

---

## ASAMA 2: Uygulama Kabugu ve Temel UI Layout

### 2.1 Ust Menu Bar
- File menusu: Save, Open, Export JSON, Export Markdown (baslangicta placeholder olabilir)
- Edit menusu: Undo, Redo
- View menusu: Zoom In, Zoom Out, Fit to Screen
- Ileride Help menusu eklenebilir
- Klasik masaustu uygulamasi gorunumu

### 2.2 Ana Layout Yapisi
- Ana canvas alani (merkez — uygulamanin kalbi)
- Opsiyonel sol toolbar veya ust toolbar (temel araclar: node olustur, baglanti kur, sec)
- Inspector / side panel (sag taraf):
  - Secili node'un title duzenleme alani
  - Secili node'un description duzenleme alani
  - Secili node'un metadata bilgileri (gelecekte)
  - Hicbir node secili degilken bos veya proje bilgisi
- Mode toggle butonu (gorunur ve erisimi kolay bir yerde)

### 2.3 Gorsel His ve Tasarim
- Minimal ama cilali (polished) UI
- PureRef benzeri his: masaustu-oncelikli, yerel-oncelikli, temiz canvas
- Gorsel olarak hos ve okunabilir, odakli ve daginik olmayan
- Biraz oyunsu ve dokunsal (playful & tactile) his
- Yumusak etkilesimler

---

## ASAMA 3: Veri Modeli (Data Model)

> Tipler ve arayuzler her seyden once tanimlanmali — canvas, node ve edge sistemleri bu modeli kullanacak

### 3.1 Node Veri Yapisi (TypeScript interface/type)
- id: string — benzersiz kimlik (UUID veya nanoid)
- title: string — baslik
- description: string — aciklama
- position: { x: number, y: number } — canvas uzerindeki konum
- parentId: string | null — tek parent (MVP varsayilan mantik)
- childIds: string[] — cocuk node ID'leri
- metadata: object — opsiyonel, genisletilebilir:
  - nodeType: string (tur)
  - cost: number (maliyet)
  - tags: string[] (etiketler)
  - unlockConditions: string (acma kosullari)
  - category: string (kategori / dal)
  - iconRef: string (ikon referansi)

### 3.2 Gelecek Genisletilebilirlik
- Veri modeli multi-parent destegine izin verecek sekilde tasarlanacak
  - parentIds: string[] yapisi dusunulebilir
- Ancak MVP'de tek parent mantigi temiz ve basit kalacak
- Multi-parent karmasikligi MVP davranisini kirletmeyecek

### 3.3 Agac (Tree) Genel State Yapisi
- Tum node'larin listesi veya map'i (id -> node)
- Root node(lar) referansi
- Aktif mod (Static / Responsive)
- Secili node ID
- Canvas gorunum state'i (zoom seviyesi, pan offset)
- State yonetimi yaklasimi (React state/context veya hafif state kutuphanesi)

---

## ASAMA 4: Canvas Sistemi

### 4.1 Temel Canvas
- Buyuk, surekli canvas alani (node'larin serbestce yerlestirildigi alan)
- Canvas koordinat sistemi (ekran vs. dunya koordinatlari donusumu)

### 4.2 Zoom
- Mouse tekerlegi ile zoom in/out
- Menu veya toolbar butonlari ile zoom
- Yumusak zoom animasyonu (ani atlamalar degil)

### 4.3 Pan (Gezinme)
- Orta mouse tusu veya bos alana tikleyip surukleyerek pan
- Yumusak pan hareketi

### 4.4 Canvas Render
- Canvas uzerinde node render etme (veri modeline bagli)
- Canvas uzerinde edge render etme (veri modeline bagli)
- Performansli render (yuzlerce node iceren buyuk agaclar icin optimize)

---

## ASAMA 5: Node Sistemi

### 5.1 Node Olusturma
- Canvas uzerinde gorsel olarak olusturma (tikla veya toolbar'dan)
- Metin yazarak degil, gorsel etkilesimle (visual-first)

### 5.2 Node Secme
- Tiklamayla secim
- Secili node icin gorsel vurgulama (highlight / border / glow)
- Secim kaldirildiginda vurgu kaybolur

### 5.3 Node Duzenleme
- Baslik (title) duzenleme:
  - Cift tiklama ile inline duzenleme VEYA inspector panel uzerinden
- Aciklama (description) duzenleme:
  - Inspector panel uzerinden (daha uzun metin alani)

### 5.4 Node Surukleme (Drag & Drop)
- Tek node suruklendiginde alt agaciyla birlikte hareket eder
- Yumusak, ani olmayan hareket
- Surukleme sirasinda 60fps hedefi

### 5.5 Node Silme
- Secili node'u silme
- Silinen node'un alt agacina ne olacagi belirlenmeli:
  - Alt agac da silinir? Yoksa parent'a baglanir?
  - Kullaniciya uyari/onay gosterme

### 5.6 Node Gorsel Tasarimi
- Okunabilir, temiz, biraz oyunsu gorunum
- Birden fazla node secimi icin zemin hazirla (gelecek gelistirme)

---

## ASAMA 6: Baglanti (Edge) Sistemi

### 6.1 Baglanti Olusturma
- Gorsel olarak bir node'dan digerine surukleyerek baglama
- Varsayilan: her node'un tek parent'i olur (veya root)
- Baglanti olusturma sirasinda gorsel geri bildirim (hedef node belli olsun)

### 6.2 Baglanti Silme / Koparma
- Secili baglantiyi silme veya koparma mekanizmasi

### 6.3 Baglanti Gorsel Tasarimi
- Temiz, egri (curved / bezier) baglanti cizgileri
- Hiyerarsiyi gorsel olarak destekleyen cizgiler

### 6.4 Canli Guncelleme
- Node hareket ettikce cizgiler aninda guncellenir
- Cirkin titresim (ugly jitter) OLMAMALI
- 60fps hedefi surukleme sirasinda

### 6.5 Mod Bazli Edge Davranisi
- Static Mode: baglanti uzunluklari kullanicinin belirledigi gibi sabit kalir
- Responsive Mode: baglanti uzunluklari elastik olabilir (uzar/kisalir)

---

## ASAMA 7: Subtree (Alt Agac) Davranislari

> Alt agac hareketi bu uygulamanin EN ONEMLI ozelliklerinden biri — edge sisteminden hemen sonra uygulanmali

- Parent node suruklendiginde: tum alt agac birlikte, birim olarak hareket eder
- Child node suruklendiginde: o child ve tum torunlari birlikte hareket eder
- Static Mode'da:
  - Alt agac sekli (node'larin birbirine gore pozisyonlari) mumkun oldugunca korunur
  - Surukleme sirasinda icerideki yapiyi bozma
- Responsive Mode'da:
  - Alt agac icindeki node'lar yumusak tepki verebilir
  - Ama yapi her zaman okunabilir kalmali
- Ozenle ve dikkatle uygulanmali

---

## ASAMA 8: Etkilesim Modlari (Interaction Modes)

> Bu iki mod arasindaki ayrim UYGULAMANIN EN ONEMLI PARCALARINDAN BIRI
> Subtree davranislari kurulduktan sonra modlar uygulanir

### 8.1 Static Mode
- Amac: Kullanicinin elle olusturdugu agac sekilini koruma
- Kurallar:
  - Node'lar birbirini surekli itmeye CALISMAZ
  - Suruklenmiyorsa ve cakisma yoksa pozisyonlar KESINLIKLE oldugu gibi kalir
  - Parent suruklenince tum alt agac birlikte hareket eder
  - Child suruklenince o child ve tum torunlari birlikte hareket eder
  - Baglanti uzunluklari kullanicinin ayarladigi gibi kalir — degismez
  - Tam agac otomatik yeniden duzenleme (auto-relayout) YAPILMAZ
  - Sadece yerel cakisma cozumu (collision handling) gerektiginde devreye girer
- Cakisma cozumu kurallari:
  - Cakisan node'u parent etrafinda acisal olarak kaydir (angular slide)
  - Parent'a olan mesafeyi koru
  - Baglanti uzunlugunu mumkun oldugunca degistirme
  - Genel el yapimi (handmade) kompozisyonu bozma
  - Yerel cozum: sadece cakisan node'lari etkile, gerisine dokunma
- His: Kararli, kasitli, el yapimi, sanatsal kontrol

### 8.2 Responsive Mode
- Amac: Canli, kendini ayarlayan, oyuncak gibi bir layout davranisi
- Kurallar:
  - Yakin node'lar birbirini iter (repulsion kuvveti)
  - Parent-child baglantilari yumusak yaylar gibi davranir (spring kuvveti)
  - Baglanti uzunluklari uzayip kisalabilir (elastik)
  - Bir node'u suruklemek yakin node'larda yerel tepkilere neden olur
  - Surukleme bittikten sonra node'lar yumusak bir sekilde yerine oturur (settling)
  - Damping yeterince yuksek olmali — sistem ASLA kaotik hissettirmemeli
- AGIRLIK KURALI (cok onemli):
  - Buyuk alt agaci olan node'lar → daha agir hissedilir, daha zor hareket ettirilir
  - Ana dal kokleri (major branch roots) → bozulmaya karsi daha fazla direnc
  - Yaprak node'lar (leaf nodes) → daha kolay ve hafif hareket
  - Amac: buyuk parent yapilarin kolayca dagilmasini ve karismasini onlemek
- His: Canli, zarif, oyunsu ama hala kullanilabilir ve kontrol altinda

### 8.3 Mod Gecis Mekanizmasi
- UI'da gorunur bir toggle butonu (toolbar veya menu'de)
- Modlar arasi gecis yumusak olmali
- Mod degistiginde mevcut node pozisyonlari korunmali
- Responsive Mode'a geciste fizik simulasyonu baslatilir
- Static Mode'a geciste fizik simulasyonu durdurulur, pozisyonlar sabitlenir

---

## ASAMA 9: Fizik ve Layout Sistemi (Physics Engine)

- Bu sistem SADECE Responsive Mode'da aktif
- Static Mode'da fizik simulasyonu calismaz (cakisma cozumu haric)
- Temel kuvvetler:
  - Repulsion: yakin node'lar arasi itme kuvveti (ust uste binmeyi onler)
  - Spring: parent-child bagli node'lar arasi yay benzeri cekim (baglanti mesafesini korur)
  - Damping: sonumleme (enerjiyi emerek sistemi sakinlestirir)
- Subtree-based mass / inertia:
  - Buyuk alt agaci olan node = daha buyuk kutle = daha zor hareket
  - Yaprak node = daha kucuk kutle = daha kolay hareket
- Smooth settling: etkilesim sonrasi yumusak yerlesme animasyonu
- Ani ziplamalar degil, yumusak gecisler
- Kaotik parcacik simulasyonu gibi DEGIL — tasarimci dostu ve okunabilir olmali
- Fizik dongusu: requestAnimationFrame veya benzeri mekanizma
- Performans: buyuk agaclarda bile akici calisabilmeli

---

## ASAMA 10: Undo / Redo (Geri Al / Yeniden Yap)

- Desteklenmesi gereken islemler:
  - Node olusturma
  - Node silme
  - Node tasinmasi (pozisyon degisikligi)
  - Node basligi/aciklamasi degisikligi
  - Baglanti kurma
  - Baglanti koparma/silme
  - Toplu subtree hareketi
- Command/action history pattern kullanilabilir
- Edit menusu uzerinden erisim (Undo / Redo)
- Klavye kisayollari: Ctrl+Z (geri al), Ctrl+Shift+Z veya Ctrl+Y (yeniden yap)
- History stack'in makul bir siniri olmali (bellek tasmasi onlemi)

---

## ASAMA 11: Kaydetme ve Yukleme (Save / Load)

### 11.1 Kaydetme
- Tauri dosya sistemi API'si kullanilacak (fs ve dialog)
- Dosya kaydetme dialog'u ile konum secimi
- Proje dosya formati — JSON bazli, tum state'i icerir:
  - Tum node'lar (pozisyonlari, basliklari, aciklamalari, baglantilari, metadata)
  - Canvas gorunum ayarlari (zoom seviyesi, pan offset)
  - Aktif mod
- File > Save ve File > Save As

### 11.2 Yukleme
- Dosya acma dialog'u ile dosya secimi
- Yuklendiginde tum state geri yuklenir
- File > Open

### 11.3 Genel Kurallar
- Sunucu YOK, auth YOK, cloud YOK, isbirligi YOK — tamamen yerel
- Kaydedilmemis degisiklik uyarisi (kapatirken veya yeni proje acarken)

---

## ASAMA 12: Export (Dis Aktarim)

### 12.1 JSON Export
- Yapilandirilmis, temiz, okunabilir JSON ciktisi
- Tum agac yapisini icerir
- Baska AI'lara veya araclara verilebilecek format

### 12.2 Markdown Export
- AI-dostu VE insan tarafindan okunabilir format
- Her node icin:
  - Title (baslik)
  - Description (aciklama)
  - Parent (ust node bilgisi)
  - Children (alt node'lar listesi)
  - Metadata (varsa)
- Agac hiyerarsisini yansiatan girintili/baslikli yapi

### 12.3 Genel Kurallar
- File menusu uzerinden erisim: File > Export as JSON, File > Export as Markdown
- Export ciktisi PROJE DOSYASINDAN FARKLI — export disari aktarim, proje dosyasi ic state

---

## Hareket ve Animasyon Prensipleri (Tum Asamalarda Gecerli)
- Tum hareketlerde yumusak gecisler (smooth transitions)
- Ani ziplamalar (abrupt jumps) OLMAMALI
- Surukleme, zoom, pan islemlerinde 60fps hedefi
- Repulsion, spring, damping, subtree mass kavramlari tutarli uygulanmali
- Etkilesim sonrasi yumusak yerlesme (settling)
- Tasarimci dostu, okunabilir his — asla kaotik degil

---

## Gelistirme Yaklasimi (Tum Asamalarda Gecerli)
- Artan (incremental) gelistirme: dev nihai uygulamaya atlamak yerine adim adim insa et
- Her buyuk asamadan sonra rapor:
  - Ne tamamlandi
  - Hangi dosyalar olusturuldu/guncellendi
  - Mevcut davranis nasil calisiyor
  - Bir sonraki adim ne olmali
- Buyuk miktarda kod yazmadan once uygulama planini acikla
- Asiri muhendislik (overengineering) yapma
- Net, moduler, pratik mimari

---

## MVP Disinda Kalanlar (YAPILMAYACAK)
- Cloud sync
- Kullanici hesaplari / auth
- Backend / sunucu
- Isbirligi (collaboration) ozellikleri
- Unity import
- Collapse / expand gruplari
- Gelismis tema sistemi (advanced theming)
- Karmasik multi-parent UI akislari
  (gelecek icin veri modelinde HAZIRLIK YAP ama MVP'de UI'da gosterme)
