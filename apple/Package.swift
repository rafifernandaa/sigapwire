// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SigapWireApple",
    platforms: [
        .iOS("26.0"),
        .macOS("26.0")
    ],
    products: [
        .library(
            name: "SigapWireAppleCore",
            targets: ["SigapWireAppleCore"]
        )
    ],
    dependencies: [
        .package(
            url: "https://github.com/firebase/firebase-ios-sdk.git",
            from: "12.13.0"
        )
    ],
    targets: [
        .target(
            name: "SigapWireAppleCore",
            dependencies: [
                .product(name: "FirebaseCore", package: "firebase-ios-sdk"),
                .product(name: "FirebaseAppCheck", package: "firebase-ios-sdk"),
                .product(name: "FirebaseAuth", package: "firebase-ios-sdk"),
                .product(name: "FirebaseFirestore", package: "firebase-ios-sdk"),
                .product(name: "FirebaseRemoteConfig", package: "firebase-ios-sdk"),
                .product(name: "FirebaseAILogic", package: "firebase-ios-sdk")
            ],
            path: "SigapWireApple",
            exclude: ["SigapWireAppleApp.swift"]
        )
    ]
)
