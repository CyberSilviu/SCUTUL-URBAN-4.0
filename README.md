# Scut Urban 4.0 – Platformă de Monitorizare Urbană

> **O platformă integrată de monitorizare urbană pentru siguranța cetățenilor — seismicitate în timp real și calitate aer, accesibilă de pe orice dispozitiv.**

---

## Ce este acest proiect?

**Scut Urban 4.0** este o platformă web și Android care pune la dispoziția cetățenilor două module de monitorizare a mediului urban:

- **SeismicWatch** – monitor seismic în timp real, cu date de la stația R0B3B a Colegiului Tehnic de Căi Ferate "Unirea" Pășcani, procesate din rețeaua globală RaspberryShake și validate cu datele oficiale INFP.
- **Stație Calitate Aer** – tablou de bord cu 8 senzori de mediu (praf, CO, CH₄, H₂, NH₃, NO₂, UV, etanol), cu date live stocate în Firebase.

Scopul proiectului este **siguranța și informarea comunității** – oricine poate vedea activitatea seismică și calitatea aerului din zonă, în timp real, de pe telefon sau browser.

---

## Unde se poate accesa?

| Platformă | Link / Metodă |
|-----------|---------------|
| 🌐 **Landing page** | Găzduit pe **GitHub Pages / Netlify** – prezintă platforma și linkurile spre module |
| 🌍 **SeismicWatch** | [seismicwatch.netlify.app](https://seismicwatch.netlify.app/) |
| 🌿 **Stație Calitate Aer** | [statie-calitate-aer.netlify.app](https://statie-calitate-aer.netlify.app/) |
| 📱 **Android APK** | Fișier `ScutUrban4.0.apk` disponibil în repository – se instalează direct pe telefon |

---

## Module

### 1. 🌍 SeismicWatch — R0B3B Monitor

Monitor seismic în timp real pentru România, cu accent pe stația locală **AM.R0B3B.00.EHZ** a Colegiului Tehnic "Unirea" Pășcani.

**Ce afișează:**
- Seismograma în timp real (ultimele 2 minute de date)
- Filtru Butterworth bandpass 0.5–4 Hz (banda cutremurelor)
- Clasificare automată a sursei: seismic / trafic / vânt / antropic
- Lista ultimelor cutremure din România (sursa INFP)
- Alertă vizuală și sonoră la magnitudine ≥ 3.0
- Date actualizate la fiecare 60 de secunde

**Sursă date:** RaspberryShake FDSN (`data.raspberryshake.org`) prin proxy Netlify Function (pentru CORS), validat cu INFP.

---

### 2. 🌿 Stație Calitate Aer Live

Tablou de bord pentru monitorizarea calității aerului cu senzori fizici locali.

**Hardware utilizat:**

| Componentă | Model | Alimentare | Rol |
|------------|-------|-----------|-----|
| **Microcontroller** | Arduino Uno | 5V | Citire senzori, trimitere date seriale |
| **Computer de bord** | Raspberry Pi 4 | 5V | Procesare date, publicare Firebase via Node-RED |
| **Senzor particule praf** | GP2Y1014AU0F (Sharp) | 5V | Măsoară concentrația de praf (mg/m³) |
| **Senzor UV** | GY-8511 (ML8511) | 3.3V | Măsoară radiația UVA și UVB (mW/cm²) |
| **Senzor gaze** | MICS-5524 (VOC) | 5V | Detectează CO, CH₄, etanol, H₂, NH₃, NO₂ |

**Flux date hardware → cloud:**
```
Arduino Uno (citire senzori analogici)
        ↓ Serial / I²C
Raspberry Pi 4
        ↓ Node-RED (flow de procesare și publicare)
Firebase Realtime Database
        ↓ fetch JSON (1 secundă)
Browser / WebView
```

**Parametri monitorizați:**

| Senzor | Model | Unitate | Limită avertizare |
|--------|-------|---------|-------------------|
| Praf (particule) | GP2Y1014AU0F | mg/m³ | > 0.05 |
| Radiație UV | GY-8511 | mW/cm² | > 3.0 |
| CO – Monoxid carbon | MICS-5524 | PPM | > 9.0 |
| CH₄ – Metan | MICS-5524 | PPM | > 50.0 |
| Etanol (VOC) | MICS-5524 | PPM | > 100.0 |
| H₂ – Hidrogen | MICS-5524 | PPM | > 100.0 |
| NH₃ – Amoniac | MICS-5524 | PPM | > 25.0 |
| NO₂ – Dioxid azot | MICS-5524 | PPM | > 0.1 |

Date actualizate la fiecare **1 secundă** din Firebase Realtime Database.

---

## Aplicația Android

Aplicația **Scut Urban 4.0** pentru Android este un wrapper nativ construit cu **Capacitor v8**, care integrează ambele module într-o singură aplicație:

- Ecran principal cu logo, titlu și două butoane mari
- Fiecare modul se deschide într-un **WebView intern** (nu browser extern)
- Bară cu buton **← Înapoi** pentru navigare înapoi la ecranul principal
- Butonul fizic Back Android funcționează
- SeismicWatch scalat la 80% pentru vizibilitate optimă pe ecrane mici
- Iconița aplicației: scutul Scut Urban 4.0

**Instalare APK:**
1. Descarcă `ScutUrban4.0.apk` din acest repository
2. Pe telefon: **Setări → Securitate → Surse necunoscute** (activează)
3. Deschide fișierul APK și apasă **Instalare**

---

## Cum funcționează tehnic?

### Tehnologii folosite

| Tehnologie | Rol | Ce înseamnă simplu |
|------------|-----|--------------------|
| **HTML5 + CSS3** | Structura și aspectul vizual | „Scheletul" și „îmbrăcămintea" aplicației |
| **JavaScript (Vanilla)** | Logica aplicației | „Creierul" care face totul să funcționeze |
| **Chart.js** | Graficul seismogramei | Biblioteca pentru vizualizarea semnalului seismic |
| **RaspberryShake FDSN API** | Date seismice brute | Server care furnizează înregistrările în format miniSEED |
| **Netlify Functions** | Proxy serverless | Decodifică datele binare miniSEED și rezolvă problema CORS |
| **Arduino Uno** | Citire senzori | Microcontroller-ul care citește valorile analogice de la senzori |
| **Raspberry Pi 4** | Procesare și publicare | Computer de bord care primește datele și le trimite în cloud |
| **Node-RED** | Flow de automatizare | Platformă vizuală care procesează și publică datele în Firebase |
| **Firebase Realtime Database** | Date calitate aer | Baza de date cloud unde senzorii fizici trimit măsurătorile |
| **Capacitor v8** | Aplicație Android | Transformă site-ul web într-o aplicație Android `.apk` |
| **Netlify** | Găzduire web + funcții | Serverul care face modulele accesibile online |
| **GitHub** | Versionare cod | Istoricul tuturor modificărilor, backup și publicare |
| **sharp** | Procesare imagini | Generare iconițe APK din SVG la toate rezoluțiile Android |

### Arhitectura datelor SeismicWatch

```
Senzor RaspberryShake (R0B3B, Pășcani)
        ↓
data.raspberryshake.org (FDSN – format binar miniSEED)
        ↓
Netlify Function: seismic.js
  ├── Decodificare Steim-2 (miniSEED → samples numerice)
  ├── Detrend (eliminare offset DC)
  ├── Filtru Butterworth bandpass 0.5–4 Hz
  └── Clasificare sursă (seismic / trafic / vânt / antropic)
        ↓
Browser / WebView (Chart.js → seismogramă)
```

### Arhitectura datelor Stație Aer

```
Senzori fizici locali (8 senzori)
        ↓
Firebase Realtime Database
  └── airquality-76b25-default-rtdb.firebaseio.com
        ↓
Browser / WebView (fetch JSON → tablou de bord)
```

### Structura repository-ului

```
SCUTUL URBAN 4.0/
├── index.html              ← Landing page (prezentare platformă + download APK)
├── ScutUrban4.0.apk        ← Fișierul de instalare Android
├── seismicwatch/
│   ├── index.html          ← Aplicația SeismicWatch completă
│   ├── netlify.toml        ← Configurare deploy Netlify
│   └── netlify/functions/
│       └── seismic.js      ← Proxy serverless (decodare miniSEED)
├── statie_aer/
│   └── index.html          ← Aplicația Stație Calitate Aer
└── apk-build/
    ├── www/
    │   └── index.html      ← Ecranul principal al APK-ului
    ├── assets/
    │   └── icon.png        ← Iconița sursă (1024×1024)
    ├── capacitor.config.json
    ├── package.json
    └── generate_icon.js    ← Script generare iconițe Android
```

### Cum se actualizează și recompilează APK-ul

```bash
# 1. Modifică fișierele din apk-build/www/
# 2. Sincronizează cu proiectul Android
npx cap sync android

# 3. Compilează APK debug
cd android && ./gradlew assembleDebug

# 4. Copiază APK-ul în folderul principal
cp android/app/build/outputs/apk/debug/app-debug.apk ../ScutUrban4.0.apk

# 5. Regenerare iconițe (dacă e nevoie)
node generate_icon.js
npx @capacitor/assets generate --android

# 6. Push pe GitHub
git add . && git commit -m "Update" && git push
```

---

## Surse de date

| Sursă | Date furnizate |
|-------|----------------|
| **RaspberryShake / FDSN** | Date seismice brute de la stația AM.R0B3B (Pășcani) |
| **INFP** | Lista oficială a cutremurelor din România |
| **Firebase Realtime Database** | Măsurători live de la senzorii de calitate aer |
| **Google Fonts** | Tipografii (Barlow, Share Tech Mono) |

---

## Identitate vizuală

Logo-ul **Scut Urban 4.0** este un scut stilizat cu două elemente:
- O **undă seismică** (albastru `#60a5fa`) – reprezentând modulul SeismicWatch
- Trei **puncte verzi** (`#34d399`) – reprezentând senzorii de calitate aer

| Culoare | Hex | Semnificație |
|---------|-----|--------------|
| 🔵 Albastru | `#2563eb` | **Seismic** – monitorizare seismică, siguranță |
| 🟢 Verde | `#10b981` | **Aer** – calitate mediu, sănătate |

Font utilizat: **Barlow Condensed** (titluri) + **Barlow** (text) + **Share Tech Mono** (date tehnice)

---

## Repository GitHub

| Repository | Conținut |
|------------|---------|
| `CyberSilviu/SCUTUL-URBAN-4.0` | Landing page + APK + cod sursă module |

---

## Cine a construit acest proiect?

Proiect inițiat și coordonat de **Colegiul Tehnic de Căi Ferate "Unirea" Pășcani**, cu scopul de a pune la dispoziția comunității instrumente de monitorizare a mediului urban în timp real.

Dezvoltat cu ajutorul **Claude (Anthropic)** – asistent AI utilizat pentru scrierea și gestionarea codului, arhitectura platformei și implementarea funcționalităților tehnice.

---

*Ultima actualizare: Martie 2026*
