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
            regionHint = "Cianjur Corridor, West Java (Synthetic Drill)",
            rawInput = listOf(
                "[POSKO REKAP LAPANGAN MULTI-KECAMATAN - SIMULASI LATIHAN GEMPA M6.2 - BUKAN DATA RESMI]",
                "14:10 WIB | Kec. Cugenang - Posko Desa Sukamaju: Laporan awal dari koordinator relawan Pak Agus Pratama (0812-0000-1101, Jl. Kenanga No. 8 RT 01/RW 03). Jembatan penghubung antar dusun retak struktural sehingga truk logistik belum diizinkan melintas. Sebanyak 145 warga berkumpul di lapangan SD Sukamaju, termasuk 38 lansia dan 12 balita. Listrik padam dan sinyal seluler terputus. Kebutuhan mendesak: 4 tenda pleton, 600 liter air minum, terpal 6x8m, dan genset posko.",
                "14:22 WIB | Kec. Pacet - Dusun Cipendawa: Update dari Ibu Sari Wulandari (+62 813-0000-2202, @sari_pacet). Tebing setinggi 12 meter mengalami longsor menutup separuh badan jalan sepanjang 30 meter. Puskesmas pembantu melaporkan stok perban steril dan cairan infus menipis. Dibutuhkan 1 loader ringan untuk pembersihan material.",
                "14:35 WIB | Kec. Warungkondang - Desa Mekarsari: Transkrip relawan Sdr. Dimas Wijaya (0856-0000-3303, Jl. Anggrek No. 21 RT 04). Pipa induk PDAM patah 40 meter menyebabkan 420 KK kehilangan air bersih. Terdapat 3 pasien pasca-operasi dan 2 ibu hamil trimester akhir butuh transportasi siaga.",
                "14:48 WIB | Kec. Gekbrong - Pasar & Jalur Utama: Petugas Bapak Budi Hartono (0817-0000-4404, Jl. Dahlia No. 5 RT 02) melaporkan atap los pasar belakang ambruk menimpa 6 kios kosong tanpa korban jiwa. Tiang listrik miring 20 derajat di depan SPBU Gekbrong; warga diminta menjauh radius 15 meter.",
                "15:02 WIB | Kec. Sukaresmi - Posko Kesehatan: Bidan Ibu Maya Kusuma (+62 815-0000-5505, @maya_bidan_id) mendata 210 pengungsi di kantor kecamatan. Sembilan warga luka ringan tertangani; stok BBM ambulans tersisa 35 persen dan membutuhkan lampu surya serta tenda ibu menyusui.",
                "15:18 WIB | Kec. Karangtengah - Gudang Logistik: Koordinator Sdri. Nadia Putri (0819-0000-6606, Jl. Flamboyan No. 19 RT 03) melaporkan struktur gudang aman dengan stok 120 dus mi instan, 80 paket keluarga, dan 45 gulung terpal, menunggu rute aman 4x4 menuju Cugenang.",
                "15:31 WIB | Kec. Mande - Lereng Timur: Laporan relawan Pak Eko Saputra (0852-0000-7707, @eko_mande) mencatat retakan tanah 40 meter di atas RW 05 sehingga 28 keluarga mengungsi ke SD terdekat. Pintu air hulu terpantau normal meski beredar rumor tanggul retak.",
                "15:44 WIB | Kec. Cilaku & Ciranjang: Bapak Hendro Wibowo (0811-0000-8808, Jl. Cempaka No. 11 RT 05) melaporkan 95 pelaju tertahan di terminal dengan baterai ponsel menipis; Ibu Lestari Ningsih (0821-0000-9909, Jl. Mawar No. 3 RT 01) melaporkan saluran irigasi bergeser 25 meter di Blok Sawah Baru.",
                "15:56 WIB | Ringkasan Kesenjangan Informasi: Angka pasti luka ringan di dusun terluar, status teknis jembatan Sukamaju oleh tim PUPR, dan klarifikasi tertulis pengelola pintu air Mande masih menunggu konfirmasi resmi sebelum rilis nasional dan global."
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
