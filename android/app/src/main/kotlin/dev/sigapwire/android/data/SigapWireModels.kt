package dev.sigapwire.android.data

enum class IntakeMode {
    FIELD_REPORT,
    RUMOR_CHECK
}

enum class HazardType {
    EARTHQUAKE,
    FLOOD,
    VOLCANO,
    LANDSLIDE,
    TSUNAMI,
    OTHER
}

enum class SeverityLevel {
    CRITICAL,
    HIGH,
    MEDIUM,
    LOW
}

enum class RumorVerdict {
    VERIFIED,
    MISLEADING,
    UNVERIFIED_DEVELOPING,
    NOT_APPLICABLE
}

enum class InferenceSourceLabel {
    ON_DEVICE,
    IN_CLOUD
}

enum class DeviceNanoStatus {
    CHECKING,
    AVAILABLE,
    DOWNLOADABLE,
    DOWNLOADING,
    UNAVAILABLE,
    ERROR
}

enum class RedactionCategory {
    PERSON_NAME,
    PHONE_NUMBER,
    CHAT_HANDLE,
    ADDRESS_DETAIL,
    OTHER_PII
}

data class RedactionItem(
    val category: RedactionCategory,
    val placeholder: String,
    val reason: String
)

data class LocalPrivacyResult(
    val sanitizedText: String,
    val redactions: List<RedactionItem>,
    val inferenceSource: InferenceSourceLabel,
    val latencyMs: Long,
    val usedRegexFallback: Boolean
)

data class GroundingSource(
    val title: String,
    val uri: String
)

data class StructuredIntake(
    val headline: String,
    val hazardType: HazardType,
    val location: String,
    val severity: SeverityLevel,
    val summaryId: String,
    val summaryEn: String,
    val keyFacts: List<String>,
    val urgentNeeds: List<String>,
    val verificationGaps: List<String>,
    val rumorVerdict: RumorVerdict,
    val panicSignals: List<String>,
    val groundingSources: List<GroundingSource>,
    val searchEntryPointHtml: String? = null
)

data class HybridTriageResult(
    val structured: StructuredIntake,
    val inferenceSource: InferenceSourceLabel,
    val inferenceModeRequested: String,
    val latencyMs: Long,
    val routingReason: String,
    val estimatedInputTokens: Int
)

data class GroundedVerificationResult(
    val verdict: RumorVerdict,
    val factId: String,
    val factEn: String,
    val sources: List<GroundingSource>,
    val searchEntryPointHtml: String?,
    val webSearchQueries: List<String>,
    val latencyMs: Long
)

data class FieldVerificationTask(
    val id: String,
    val incidentId: String,
    val question: String,
    val location: String,
    val status: String,
    val requestedPlatform: String,
    val createdAtMillis: Long
)

data class AreaKnowledgeFact(
    val id: String,
    val fact: String,
    val category: String,
    val active: Boolean,
    val createdAtMillis: Long
)

data class DispatchCard(
    val id: String,
    val incidentId: String,
    val dispatchNumber: Int,
    val severity: SeverityLevel,
    val inferenceSource: InferenceSourceLabel,
    val publishedAtMillis: Long,
    val communityTitle: String,
    val communityWhatHappened: String,
    val communityDoNow: List<String>,
    val communityAvoid: List<String>,
    val whatsappShortText: String,
    val mediaHeadline: String,
    val mediaDateline: String,
    val mediaBody: String,
    val mediaKeyMetrics: List<String>,
    val globalHeadline: String,
    val globalExecutiveSummary: String,
    val globalImpactOverview: List<String>,
    val globalPriorityNeeds: List<String>,
    val globalInformationGaps: List<String>,
    val hasRumorAlert: Boolean,
    val debunkVerdict: RumorVerdict,
    val debunkClaim: String,
    val debunkFactId: String,
    val debunkFactEn: String,
    val debunkSources: List<GroundingSource>
)

data class SyntheticScenario(
    val id: String,
    val label: String,
    val mode: IntakeMode,
    val regionHint: String,
    val rawInput: String
)

object SyntheticDrillData {
    val scenarios: List<SyntheticScenario> = listOf(
        SyntheticScenario(
            id = "field-quake-bridge",
            label = "Drill: Messy Quake Note + PII",
            mode = IntakeMode.FIELD_REPORT,
            regionHint = "Cugenang, West Java (Synthetic Drill)",
            rawInput = "Lapor cepat dr lokasi Ds. Sukamaju Cugenang, barusan gempa kenceng bgt jam 14.05 WIB. Jembatan penghubung retak parah ga bs dilewati truk logistik!! Rumah Pak Hendra Santoso (0812-0000-4411, Jl. Melati No. 14 RT 02) atap ambruk, untung keluarga selamat. Sekitar 35-40 warga ngungsi di lapangan bola, butuh air bersih, terpal, sama obat p3k cepet. Sinyal drop parah, jumlah korban luka blm tau pasti."
        ),
        SyntheticScenario(
            id = "field-flood-evac",
            label = "Drill: Flash Flood Evac Update",
            mode = IntakeMode.FIELD_REPORT,
            regionHint = "Dayeuhkolot, Bandung (Synthetic Drill)",
            rawInput = "Update lapangan banjir bandang Dayeuhkolot ketinggian air skrg 1.2 meter di jalan utama, arus deras. 2 sekolah SD terendam, listrik padam dr jam 11. Ibu Ratna Dewi (+62 813-0000-9922) lapor ada 4 lansia di blok C butuh perahu karet evakuasi segera. Akses ambulans terputus dr arah timur."
        ),
        SyntheticScenario(
            id = "field-long-regional-sitrep-dump",
            label = "Drill: Long Multi-Subdistrict Dump (Auto Cloud)",
            mode = IntakeMode.FIELD_REPORT,
            regionHint = "Cianjur & Sukabumi Corridor, West Java (Synthetic Drill)",
            rawInput = listOf(
                "[POSKO REKAP LAPANGAN MULTI-KECAMATAN - SIMULASI LATIHAN GEMPA M6.2 - BUKAN DATA RESMI]",
                "14:10 WIB | Kec. Cugenang - Posko Desa Sukamaju: Laporan awal dari koordinator relawan Pak Agus Pratama (0812-0000-1101, Jl. Kenanga No. 8 RT 01/RW 03). Guncangan dirasakan sangat kuat selama 25 detik. Jembatan penghubung antar dusun mengalami retak struktural di abutment selatan sehingga kendaraan logistik roda 4 ke atas belum diizinkan melintas. Sebanyak 145 warga berkumpul di lapangan SD Sukamaju, sementara sekitar 38 lansia dan 12 balita diprioritaskan di tenda darurat sisi barat. Jaringan listrik PLN padam sejak 14:12 WIB dan sinyal seluler hanya muncul putus-putus di area bukit. Kebutuhan mendesak: 4 unit tenda pleton, 600 liter air minum kemasan, terpal 6x8 meter, selimut anak, serta genset portabel untuk penerangan posko malam hari. Data korban luka berat masih dalam verifikasi petugas puskesmas terdekat.",
                "14:22 WIB | Kec. Pacet - Dusun Cipendawa: Update lapangan dari Ibu Sari Wulandari (+62 813-0000-2202, akun relawan @sari_pacet). Tebing setinggi 12 meter di jalur alternatif Cipendawa mengalami longsoran tanah menutup separuh badan jalan sepanjang 30 meter. Kendaraan roda dua masih bisa merayap bergantian namun berisiko saat hujan gerimis mulai turun. Tiga unit rumah warga di pinggir tebing mengalami kerusakan dinding retak parah dan penghuninya sudah dievakuasi ke balai desa. Puskesmas pembantu melaporkan persediaan perban steril, cairan infus, dan obat diare anak menipis karena lonjakan warga yang mengalami syok dan luka ringan akibat pecahan kaca. Permintaan tambahan: 1 unit alat berat loader ringan untuk pembersihan material longsor serta rambu peringatan jalan licin.",
                "14:35 WIB | Kec. Warungkondang - Desa Mekarsari: Catatan suara yang ditranskrip oleh relawan Sdr. Dimas Wijaya (0856-0000-3303, Jl. Anggrek No. 21 RT 04). Pipa induk distribusi air bersih PDAM sepanjang 40 meter patah di dua titik akibat pergeseran tanah. Sekitar 420 kepala keluarga di tiga RW kehilangan pasokan air bersih sejak pukul 14:15 WIB. Warga saat ini mengandalkan tangki masjid yang tersisa cukup untuk 6 jam ke depan. Di RT 04 terdapat 3 pasien pasca-operasi dan 2 ibu hamil trimester akhir yang membutuhkan akses transportasi siaga apabila terjadi gempa susulan. Belum ada laporan orang hilang di Desa Mekarsari, namun pendataan dusun terluar belum selesai karena jalan setapak tertutup pohon tumbang.",
                "14:48 WIB | Kec. Gekbrong - Pasar & Jalur Utama: Petugas lapangan Bapak Budi Hartono (0817-0000-4404, Jl. Dahlia No. 5 RT 02) melaporkan atap seng los pasar bagian belakang ambruk dan menimpa 6 kios kosong; tidak ada korban jiwa di area pasar karena pedagang langsung berhamburan ke halaman parkir. Tiang listrik tegangan menengah miring sekitar 20 derajat di depan SPBU Gekbrong sehingga petugas meminta warga menjauhi radius 15 meter sampai tim teknis listrik tiba. Kemacetan terjadi sepanjang 2 km arah barat karena kendaraan pribadi berhenti di bahu jalan dan beberapa pengendara menerima pesan berantai yang tidak jelas sumbernya mengenai penutupan jalur total. Diperlukan pengeras suara posko dan spanduk informasi jalur aman agar arus ambulans tidak terkunci.",
                "15:02 WIB | Kec. Sukaresmi - Posko Kesehatan Lapangan: Bidan koordinator Ibu Maya Kusuma (+62 815-0000-5505, @maya_bidan_id) menyampaikan jumlah pengungsi terdata di halaman kantor kecamatan mencapai 210 jiwa dari 4 dusun. Dua anak mengalami demam tinggi dan 9 warga mengalami luka robek ringan yang sudah ditangani secara lokal. Posko kesehatan membutuhkan tambahan lampu darurat tenaga surya, matras tahan lembab untuk lansia, susu formula darurat sesuai protokol gizi bencana, serta tenda khusus ibu menyusui. Stok BBM ambulans desa tersisa 35 persen dan SPBU terdekat belum beroperasi karena pemadaman listrik.",
                "15:18 WIB | Kec. Karangtengah - Area Gudang Logistik Wilayah: Koordinator gudang Sdri. Nadia Putri (0819-0000-6606, Jl. Flamboyan No. 19 RT 03) melaporkan struktur gudang logistik utama aman dan tidak mengalami keretakan kolom utama. Stok awal yang siap digerakkan meliputi 120 dus mi instan, 80 paket perlengkapan keluarga, 45 gulung terpal, dan 15 unit velbed. Namun armada truk engkel belum bisa menuju Kecamatan Cugenang karena retakan jembatan di Sukamaju, sehingga dibutuhkan pengalihan rute melalui jalur lingkar utara atau pengerahan kendaraan 4x4 bak terbuka. Perlu konfirmasi cepat dari tim teknis PUPR mengenai batas tonase aman di jembatan alternatif.",
                "15:31 WIB | Kec. Mande - Sektor Danau & Lereng Timur: Laporan pemantauan oleh relawan Pak Eko Saputra (0852-0000-7707, @eko_mande) menyebutkan munculnya retakan tanah memanjang sekitar 40 meter di area kebun warga di lereng timur, berjarak kurang lebih 150 meter di atas permukiman RW 05. Sebanyak 28 keluarga di bawah lereng sudah diarahkan mengungsi sementara ke gedung sekolah dasar sambil menunggu pemeriksaan geologi. Warga di grup percakapan mulai mempertanyakan rumor retaknya tanggul air di hulu, padahal kondisi pintu air pengamatan lokal tercatat normal tanpa limpasan. Tim komunikasi diminta segera merilis klarifikasi tenang berbasis hasil pengamatan petugas pintu air agar warga tidak panik.",
                "15:44 WIB | Kec. Cilaku - Titik Kumpul Stasiun & Terminal: Relawan lintas komunitas Bapak Hendro Wibowo (0811-0000-8808, Jl. Cempaka No. 11 RT 05/RW 02) melaporkan sekitar 95 pelaju dan pelajar tertahan di area terminal karena layanan transportasi antarkota menunda keberangkatan untuk pemeriksaan jalur. Mereka membutuhkan informasi resmi mengenai jadwal pemeriksaan jalan dan lokasi titik istirahat aman terdekat. Baterai ponsel warga mayoritas di bawah 20 persen karena listrik padam, sehingga stasiun pengisian daya tenaga surya di posko sangat dibutuhkan. Hingga pukul 15:45 WIB total kebutuhan air bersih lintas 8 kecamatan diperkirakan mencapai lebih dari 4.500 liter per hari, disertai kebutuhan mendesak pemeriksaan jembatan penghubung dan klarifikasi informasi publik dalam Bahasa Indonesia yang mudah dipahami serta ringkasan Bahasa Inggris untuk mitra kemanusiaan.",
                "15:50 WIB | Kec. Ciranjang - Sektor Pertanian & Jalur Timur: Petugas penyuluh lapangan Ibu Lestari Ningsih (0821-0000-9909, Jl. Mawar No. 3 RT 01) melaporkan saluran irigasi tersier di Blok Sawah Baru mengalami pergeseran tanggul sepanjang 25 meter sehingga air meluber ke jalan desa setinggi 30 cm. Lima belas warga lansia di sekitar balai dusun memerlukan alas tidur tambahan dan pemeriksaan tekanan darah rutin karena cemas pasca-gempa susulan. Tim relawan lokal @ciranjang_siaga membantu mengarahkan kendaraan logistik ringan melewati jalur kabupaten yang sudah dipastikan bersih dari pohon tumbang.",
                "15:54 WIB | Kec. Haurwangi - Posko Transit Logistik & Komunikasi: Relawan radio komunikasi Sdr. Raka Firmansyah (+62 878-0000-1010, Jl. Melati Barat No. 27 RT 06) mencatat repeater VHF darurat di bukit Haurwangi beroperasi normal memakai aki cadangan dengan sisa daya sekitar 8 jam. Sejumlah jurnalis daerah sudah berada di lokasi meminta ringkasan data resmi yang konsisten antar kecamatan agar tidak terjadi perbedaan angka pengungsi dalam siaran sore nanti.",
                "15:56 WIB | Ringkasan Kesenjangan Informasi Lintas Posko: (1) Angka pasti warga luka ringan/sedang dari dusun terluar Cugenang dan Warungkondang masih menunggu rekonsiliasi puskesmas. (2) Status kelayakan struktural jembatan Sukamaju dan jalur lingkar utara belum mendapat berita acara teknis resmi. (3) Belum ada pernyataan tertulis dari pengelola infrastruktur air mengenai kabar simpang siur di Mande. (4) Diperlukan pemisahan tegas antara laporan terverifikasi dengan catatan pengamatan awal sebelum dipublikasikan ke media nasional dan mitra kemanusiaan internasional."
            ).joinToString("\n\n")
        ),
        SyntheticScenario(
            id = "rumor-dam-collapse",
            label = "Drill: Viral Cirata Dam Rumor",
            mode = IntakeMode.RUMOR_CHECK,
            regionHint = "West Java (Synthetic Drill)",
            rawInput = "[Forwarded many times] From Group 'INFO WARGA JABAR' by @andi_kurniawan (0857-0000-7788): DARURAT!! BARUSAN DAPET INFO DR ORANG DALAM BENDUNGAN CIRATA JEBOL TOTAL!! AIR SETINGGI 10 METER MENUJU BANDUNG & CIANJUR DALAM 20 MENIT!! SEGERA LARI KE GUNUNG SEKARANG JUGA DAN SEBARKAN KE SEMUA GRUP!!"
        ),
        SyntheticScenario(
            id = "rumor-volcano-closure",
            label = "Drill: Semeru Volcanic Ash Flight Rumor",
            mode = IntakeMode.RUMOR_CHECK,
            regionHint = "East Java (Synthetic Drill)",
            rawInput = "Dapet kabar dr sepupu sy Rina (0819-0000-3300) katanya semua penerbangan di Jawa dan Bali ditutup total 7 hari mulai malam ini gara2 abu vulkanik Semeru, apa bener ya? Tolong konfirmasi mau berangkat."
        )
    )
}
