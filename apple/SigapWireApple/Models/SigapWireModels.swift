import Foundation

public enum SigapConstants {
    public static let defaultDemoIncidentId = "inc_westjava_drill_2026"
    public static let appleOnDeviceSafeInputTokens = 1600
    public static let localPrivacyChunkChars = 2200
}

public enum IntakeMode: String, CaseIterable, Codable, Sendable, Identifiable {
    case fieldReport = "FIELD_REPORT"
    case rumorCheck = "RUMOR_CHECK"

    public var id: String { rawValue }

    public var displayLabel: String {
        switch self {
        case .fieldReport: return "Field Report"
        case .rumorCheck: return "Verify Rumor"
        }
    }
}

public enum HazardType: String, CaseIterable, Codable, Sendable {
    case earthquake = "EARTHQUAKE"
    case flood = "FLOOD"
    case volcano = "VOLCANO"
    case landslide = "LANDSLIDE"
    case tsunami = "TSUNAMI"
    case other = "OTHER"

    public static func from(_ raw: String?) -> HazardType {
        guard let cleaned = raw?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() else {
            return .other
        }
        return HazardType(rawValue: cleaned) ?? .other
    }
}

public enum SeverityLevel: String, CaseIterable, Codable, Sendable {
    case critical = "CRITICAL"
    case high = "HIGH"
    case medium = "MEDIUM"
    case low = "LOW"

    public static func from(_ raw: String?) -> SeverityLevel {
        guard let cleaned = raw?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() else {
            return .medium
        }
        return SeverityLevel(rawValue: cleaned) ?? .medium
    }
}

public enum RumorVerdict: String, CaseIterable, Codable, Sendable {
    case verified = "VERIFIED"
    case misleading = "MISLEADING"
    case unverifiedDeveloping = "UNVERIFIED_DEVELOPING"
    case notApplicable = "NOT_APPLICABLE"

    public static func from(_ raw: String?) -> RumorVerdict {
        guard let cleaned = raw?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() else {
            return .unverifiedDeveloping
        }
        return RumorVerdict(rawValue: cleaned) ?? .unverifiedDeveloping
    }
}

public enum InferenceSourceLabel: String, Codable, Sendable {
    case onDevice = "ON_DEVICE"
    case inCloud = "IN_CLOUD"

    public var badgeText: String {
        switch self {
        case .onDevice: return "ON_DEVICE"
        case .inCloud: return "IN_CLOUD"
        }
    }
}

public enum AppleModelStatus: String, Sendable {
    case available = "AVAILABLE"
    case deviceNotEligible = "DEVICE_NOT_ELIGIBLE"
    case appleIntelligenceDisabled = "APPLE_INTELLIGENCE_DISABLED"
    case modelNotReady = "MODEL_NOT_READY"
    case unavailable = "UNAVAILABLE"
    case unconfigured = "UNCONFIGURED"

    public var label: String {
        switch self {
        case .available:
            return "Apple Intelligence Ready (On-Device)"
        case .deviceNotEligible:
            return "Device Not Eligible (Cloud Fallback)"
        case .appleIntelligenceDisabled:
            return "Apple Intelligence Off (Cloud Fallback)"
        case .modelNotReady:
            return "On-Device Model Downloading (Cloud Fallback)"
        case .unavailable:
            return "On-Device Unavailable (Cloud Fallback)"
        case .unconfigured:
            return "Demo Offline Mode (Add GoogleService-Info.plist)"
        }
    }

    public var isOnDeviceReady: Bool {
        self == .available
    }
}

public enum BriefingFormat: String, CaseIterable, Identifiable, Sendable {
    case executive3Bullet = "EXECUTIVE_3_BULLET"
    case bahasaPlainSummary = "BAHASA_PLAIN_SUMMARY"
    case mediaSpokespersonQuote = "MEDIA_SPOKESPERSON_QUOTE"

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .executive3Bullet: return "3-Bullet Executive Brief"
        case .bahasaPlainSummary: return "Bahasa Plain Summary"
        case .mediaSpokespersonQuote: return "Media Spokesperson Quote"
        }
    }
}

public enum RedactionCategory: String, Codable, Sendable {
    case personName = "PERSON_NAME"
    case phoneNumber = "PHONE_NUMBER"
    case chatHandle = "CHAT_HANDLE"
    case addressDetail = "ADDRESS_DETAIL"
    case otherPii = "OTHER_PII"
}

public struct RedactionItem: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let category: RedactionCategory
    public let placeholder: String
    public let reason: String

    public init(
        id: String = UUID().uuidString,
        category: RedactionCategory,
        placeholder: String,
        reason: String
    ) {
        self.id = id
        self.category = category
        self.placeholder = placeholder
        self.reason = reason
    }
}

public struct LocalPrivacyResult: Sendable {
    public let sanitizedText: String
    public let redactions: [RedactionItem]
    public let inferenceSource: InferenceSourceLabel
    public let usedLocalModel: Bool
    public let latencyMs: Int
    public let usedRegexFallback: Bool
}

public struct GroundingSource: Identifiable, Codable, Sendable, Hashable {
    public let id: String
    public let title: String
    public let uri: String

    public init(id: String = UUID().uuidString, title: String, uri: String) {
        self.id = id
        self.title = title
        self.uri = uri
    }
}

public struct StructuredIntake: Codable, Sendable {
    public let headline: String
    public let hazardType: HazardType
    public let location: String
    public let severity: SeverityLevel
    public let summaryId: String
    public let summaryEn: String
    public let keyFacts: [String]
    public let urgentNeeds: [String]
    public let verificationGaps: [String]
    public let rumorVerdict: RumorVerdict
    public let panicSignals: [String]
    public var groundingSources: [GroundingSource]
    public var searchEntryPointHtml: String?
}

public struct HybridTriageResult: Sendable {
    public let structured: StructuredIntake
    public let inferenceSource: InferenceSourceLabel
    public let inferenceModeRequested: String
    public let latencyMs: Int
    public let routingReason: String
    public let estimatedInputTokens: Int
    public let ranOfflineDeterministicFallback: Bool
}

public struct FieldVerificationTask: Identifiable, Equatable, Sendable {
    public let id: String
    public let incidentId: String
    public let question: String
    public let location: String
    public let status: String
    public let requestedPlatform: String
    public let answerText: String?
    public let answerPlatform: String?
    public let createdAt: Date

    public init(
        id: String,
        incidentId: String,
        question: String,
        location: String,
        status: String,
        requestedPlatform: String,
        answerText: String? = nil,
        answerPlatform: String? = nil,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.incidentId = incidentId
        self.question = question
        self.location = location
        self.status = status
        self.requestedPlatform = requestedPlatform
        self.answerText = answerText
        self.answerPlatform = answerPlatform
        self.createdAt = createdAt
    }
}

public struct AreaKnowledgeFact: Identifiable, Equatable, Sendable {
    public let id: String
    public let fact: String
    public let category: String
    public let active: Bool
    public let createdAt: Date

    public init(
        id: String,
        fact: String,
        category: String,
        active: Bool,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.fact = fact
        self.category = category
        self.active = active
        self.createdAt = createdAt
    }
}

public struct DispatchCard: Identifiable, Sendable {
    public let id: String
    public let incidentId: String
    public let dispatchNumber: Int
    public let severity: SeverityLevel
    public let inferenceSource: InferenceSourceLabel
    public let publishedAt: Date
    public let communityTitle: String
    public let communityWhatHappened: String
    public let communityDoNow: [String]
    public let communityAvoid: [String]
    public let whatsappShortText: String
    public let mediaHeadline: String
    public let mediaDateline: String
    public let mediaBody: String
    public let mediaKeyMetrics: [String]
    public let globalHeadline: String
    public let globalExecutiveSummary: String
    public let globalImpactOverview: [String]
    public let globalPriorityNeeds: [String]
    public let globalInformationGaps: [String]
    public let hasRumorAlert: Bool
    public let debunkVerdict: RumorVerdict
    public let debunkClaim: String
    public let debunkFactId: String
    public let debunkFactEn: String
    public let debunkSources: [GroundingSource]
}

public struct SyntheticScenario: Identifiable, Sendable {
    public let id: String
    public let label: String
    public let mode: IntakeMode
    public let regionHint: String
    public let rawInput: String
    public let note: String
}

public enum SyntheticDrillData {
    public static let scenarios: [SyntheticScenario] = [
        SyntheticScenario(
            id: "field-quake-bridge",
            label: "Drill: Messy Quake Field Note (ID/EN + PII)",
            mode: .fieldReport,
            regionHint: "Cugenang, West Java (Synthetic Drill)",
            rawInput: "Lapor cepat dr lokasi Ds. Sukamaju Cugenang, barusan gempa kenceng bgt jam 14.05 WIB. Jembatan penghubung retak parah ga bs dilewati truk logistik!! Rumah Pak Hendra Santoso (0812-0000-4411, Jl. Melati No. 14 RT 02) atap ambruk, untung keluarga selamat. Sekitar 35-40 warga ngungsi di lapangan bola, butuh air bersih, terpal, sama obat p3k cepet. Sinyal drop parah, jumlah korban luka blm tau pasti.",
            note: "Tests Bahasa Indonesia informal abbreviations and local PII scrubbing before hybrid inference."
        ),
        SyntheticScenario(
            id: "field-flood-evac",
            label: "Drill: Flash Flood Evac Update",
            mode: .fieldReport,
            regionHint: "Dayeuhkolot, Bandung (Synthetic Drill)",
            rawInput: "Update lapangan banjir bandang Dayeuhkolot ketinggian air skrg 1.2 meter di jalan utama, arus deras. 2 sekolah SD terendam, listrik padam dr jam 11. Ibu Ratna Dewi (+62 813-0000-9922) lapor ada 4 lansia di blok C butuh perahu karet evakuasi segera. Akses ambulans terputus dr arah timur.",
            note: "Tests high-urgency disruption extraction and local phone/name scrubbing."
        ),
        SyntheticScenario(
            id: "field-long-regional-sitrep-dump",
            label: "Drill: Long Multi-Subdistrict Dump (Over 1,600 Tokens)",
            mode: .fieldReport,
            regionHint: "Cianjur & Sukabumi Corridor, West Java (Synthetic Drill)",
            rawInput: [
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
            ].joined(separator: "\n\n"),
            note: "Exceeds Apple on-device token safety budget (1,600 tokens) to trigger chunked local PII scrubbing followed by Cloud Gemini escalation."
        ),
        SyntheticScenario(
            id: "rumor-dam-collapse",
            label: "Drill: Viral Cirata Dam-Collapse Rumor",
            mode: .rumorCheck,
            regionHint: "West Java (Synthetic Drill)",
            rawInput: "[Forwarded many times] From Group 'INFO WARGA JABAR' by @andi_kurniawan (0857-0000-7788): DARURAT!! BARUSAN DAPET INFO DR ORANG DALAM BENDUNGAN CIRATA JEBOL TOTAL!! AIR SETINGGI 10 METER MENUJU BANDUNG & CIANJUR DALAM 20 MENIT!! SEGERA LARI KE GUNUNG SEKARANG JUGA DAN SEBARKAN KE SEMUA GRUP!!",
            note: "Tests handle/phone redaction, panic-signal extraction, and cloud Google Search grounding."
        ),
        SyntheticScenario(
            id: "rumor-volcano-closure",
            label: "Drill: Unverified Semeru Flight Closure Rumor",
            mode: .rumorCheck,
            regionHint: "East Java (Synthetic Drill)",
            rawInput: "Dapet kabar dr sepupu sy Rina (0819-0000-3300) katanya semua penerbangan di Jawa dan Bali ditutup total 7 hari mulai malam ini gara2 abu vulkanik Semeru, apa bener ya? Tolong konfirmasi mau berangkat.",
            note: "Tests nuanced verification returning UNVERIFIED_DEVELOPING when full 7-day closure lacks authoritative confirmation."
        )
    ]

    public static let sampleOfflineDispatch = DispatchCard(
        id: "demo-offline-dispatch-1",
        incidentId: SigapConstants.defaultDemoIncidentId,
        dispatchNumber: 1,
        severity: .high,
        inferenceSource: .inCloud,
        publishedAt: Date(),
        communityTitle: "Gempa Cianjur (Simulasi Latihan): Jalur Jembatan Sukamaju Ditutup untuk Truk",
        communityWhatHappened: "Gempa terasa kuat di Kecamatan Cugenang. Jembatan penghubung Desa Sukamaju mengalami retak struktural sehingga sementara tidak dapat dilintasi truk logistik.",
        communityDoNow: [
            "Gunakan jalur lingkar utara untuk kendaraan roda empat dan ambulans.",
            "Warga sekitar jembatan tetap berada di lapangan terbuka yang aman dari reruntuhan.",
            "Prioritaskan air bersih dan selimut untuk lansia serta anak-anak di posko lapangan."
        ],
        communityAvoid: [
            "Jangan melintasi jembatan Sukamaju dengan kendaraan berat sebelum inspeksi teknis selesai.",
            "Jangan meneruskan pesan berantai tanpa sumber resmi posko."
        ],
        whatsappShortText: "[SIMULASI LATIHAN SIGAPWIRE] Jembatan Sukamaju Cugenang retak dan ditutup bagi truk logistik. Gunakan jalur lingkar utara. Kebutuhan mendesak: air bersih, terpal, P3K. Pintu air hulu normal; abaikan rumor tanggul jebol.",
        mediaHeadline: "Siaran Pers Latihan: Retakan Jembatan Sukamaju Alihkan Arus Logistik Cugenang",
        mediaDateline: "CIANJUR (SIMULASI LATIHAN)",
        mediaBody: "Rekap awal posko lapangan mencatat retakan struktural pada jembatan penghubung Desa Sukamaju, Kecamatan Cugenang. Kendaraan logistik berat dialihkan melalui rute lingkar utara sementara tim teknis meninjau struktur abutment. Sekitar 35 hingga 40 warga berkumpul sementara di lapangan desa dengan kebutuhan mendesak air bersih, terpal, dan perlengkapan pertolongan pertama.",
        mediaKeyMetrics: [
            "35 hingga 40 warga mengungsi sementara (laporan posko)",
            "1 jembatan penghubung dibatasi untuk kendaraan berat",
            "Data korban luka berat masih dalam verifikasi petugas kesehatan"
        ],
        globalHeadline: "West Java Earthquake Drill: Bridge Access Restricted in Cugenang",
        globalExecutiveSummary: "Field reports from Sukamaju Village in Cugenang indicate structural cracking on a local logistics bridge. Humanitarian truck access is being rerouted via the northern ring road while health and engineering checks remain in progress.",
        globalImpactOverview: [
            "Approximately 35 to 40 residents gathered at an open sports field shelter.",
            "Heavy logistics bridge restricted pending structural assessment."
        ],
        globalPriorityNeeds: [
            "Clean drinking water and tarpaulins",
            "First-aid supplies and portable solar lighting"
        ],
        globalInformationGaps: [
            "Official structural clearance certificate from public works engineers",
            "Verified injury count from outer sub-hamlets"
        ],
        hasRumorAlert: true,
        debunkVerdict: .misleading,
        debunkClaim: "Viral message claiming Cirata Dam collapsed completely sending a 10m wall of water to Bandung and Cianjur within 20 minutes.",
        debunkFactId: "KLARIFIKASI: Kabar jebolnya Bendungan Cirata tidak memiliki konfirmasi resmi. Pemantauan pintu air tetap dilakukan secara berkala melalui kanal resmi otoritas pengelola.",
        debunkFactEn: "CLARIFICATION: Claims of a catastrophic Cirata Dam failure lack official confirmation. Authorities monitor reservoir gates through verified channels.",
        debunkSources: []
    )
}
