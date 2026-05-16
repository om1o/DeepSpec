import SwiftUI
import UIKit

struct CameraScreen: View {
    @StateObject private var camera = CameraController()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch camera.accessState {
            case .checking:
                ProgressView()
                    .tint(.white)

            case .denied:
                PermissionView {
                    camera.openSettings()
                }

            case .authorized:
                CameraPreview(session: camera.session)
                    .ignoresSafeArea()

                ScanOverlay()

                VStack {
                    TopBar(camera: camera)
                    Spacer()
                    BottomControls(camera: camera)
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 18)
            }
        }
        .task {
            camera.configure()
        }
        .alert("Camera Error", isPresented: camera.showingError) {
            Button("OK", role: .cancel) {
                camera.clearError()
            }
        } message: {
            Text(camera.captureError ?? "Unknown camera error.")
        }
    }
}

private struct TopBar: View {
    @ObservedObject var camera: CameraController

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("DeepSpec")
                    .font(.system(size: 24, weight: .800, design: .rounded))
                Text("Camera")
                    .font(.system(size: 13, weight: .600))
                    .foregroundStyle(.white.opacity(0.68))
            }

            Spacer()

            Button {
                camera.switchCamera()
            } label: {
                Image(systemName: "arrow.triangle.2.circlepath.camera")
                    .font(.system(size: 20, weight: .semibold))
                    .frame(width: 48, height: 48)
                    .background(.black.opacity(0.45), in: Circle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(.white)
            .accessibilityLabel("Switch camera")
        }
        .foregroundStyle(.white)
    }
}

private struct BottomControls: View {
    @ObservedObject var camera: CameraController

    var body: some View {
        HStack(alignment: .center) {
            LastPhotoThumbnail(image: camera.lastPhoto)

            Spacer()

            Button {
                camera.capturePhoto()
            } label: {
                ZStack {
                    Circle()
                        .stroke(.white, lineWidth: 5)
                        .frame(width: 82, height: 82)
                    Circle()
                        .fill(.white)
                        .frame(width: 62, height: 62)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Take photo")

            Spacer()

            Text("Hold steady")
                .font(.system(size: 13, weight: .700))
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(.black.opacity(0.45), in: Capsule())
                .foregroundStyle(.white)
        }
    }
}

private struct LastPhotoThumbnail: View {
    let image: UIImage?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.black.opacity(0.45))
                .frame(width: 58, height: 58)

            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 58, height: 58)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            } else {
                Image(systemName: "photo")
                    .foregroundStyle(.white.opacity(0.72))
            }
        }
        .accessibilityLabel(image == nil ? "No photo captured yet" : "Last captured photo")
    }
}

private struct ScanOverlay: View {
    var body: some View {
        GeometryReader { proxy in
            let width = min(proxy.size.width - 54, 330)
            let height = width * 1.25

            ZStack {
                RoundedRectangle(cornerRadius: 30, style: .continuous)
                    .stroke(.white.opacity(0.14), lineWidth: 1)
                    .frame(width: width, height: height)

                CornerMarks(width: width, height: height)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .allowsHitTesting(false)
    }
}

private struct CornerMarks: View {
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        ZStack {
            CameraCorner()
                .frame(width: 74, height: 74)
                .offset(x: -width / 2 + 37, y: -height / 2 + 37)

            CameraCorner()
                .rotationEffect(.degrees(90))
                .frame(width: 74, height: 74)
                .offset(x: width / 2 - 37, y: -height / 2 + 37)

            CameraCorner()
                .rotationEffect(.degrees(-90))
                .frame(width: 74, height: 74)
                .offset(x: -width / 2 + 37, y: height / 2 - 37)

            CameraCorner()
                .rotationEffect(.degrees(180))
                .frame(width: 74, height: 74)
                .offset(x: width / 2 - 37, y: height / 2 - 37)
        }
        .shadow(color: .cyan.opacity(0.75), radius: 8)
    }
}

private struct CameraCorner: View {
    var body: some View {
        Path { path in
            path.move(to: CGPoint(x: 4, y: 72))
            path.addLine(to: CGPoint(x: 4, y: 24))
            path.addQuadCurve(to: CGPoint(x: 24, y: 4), control: CGPoint(x: 4, y: 4))
            path.addLine(to: CGPoint(x: 72, y: 4))
        }
        .stroke(.cyan, style: StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round))
    }
}

private struct PermissionView: View {
    let openSettings: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "camera.viewfinder")
                .font(.system(size: 56, weight: .semibold))
                .foregroundStyle(.cyan)

            Text("Camera Access Needed")
                .font(.system(size: 24, weight: .800, design: .rounded))
                .foregroundStyle(.white)

            Text("DeepSpec is just a camera app right now. Allow camera access so you can point it at parts.")
                .font(.system(size: 15, weight: .500))
                .foregroundStyle(.white.opacity(0.72))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)

            Button("Open Settings", action: openSettings)
                .font(.system(size: 16, weight: .700))
                .foregroundStyle(.black)
                .padding(.horizontal, 22)
                .padding(.vertical, 13)
                .background(.white, in: Capsule())
        }
        .padding()
    }
}

#Preview {
    CameraScreen()
}

