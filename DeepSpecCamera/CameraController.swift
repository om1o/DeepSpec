import AVFoundation
import SwiftUI
import UIKit

enum CameraAccessState {
    case checking
    case authorized
    case denied
}

final class CameraController: NSObject, ObservableObject {
    let session = AVCaptureSession()

    @Published private(set) var accessState: CameraAccessState = .checking
    @Published private(set) var lastPhoto: UIImage?
    @Published private(set) var captureError: String?

    private let sessionQueue = DispatchQueue(label: "com.deepspec.camera.session")
    private let photoOutput = AVCapturePhotoOutput()
    private var currentInput: AVCaptureDeviceInput?
    private var isConfigured = false
    private var cameraPosition: AVCaptureDevice.Position = .back

    var showingError: Binding<Bool> {
        Binding(
            get: { self.captureError != nil },
            set: { if !$0 { self.clearError() } }
        )
    }

    func configure() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            accessState = .authorized
            configureSessionIfNeeded()

        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    self?.accessState = granted ? .authorized : .denied
                    if granted {
                        self?.configureSessionIfNeeded()
                    }
                }
            }

        default:
            accessState = .denied
        }
    }

    func capturePhoto() {
        sessionQueue.async {
            let settings = AVCapturePhotoSettings()
            settings.flashMode = .off
            self.photoOutput.capturePhoto(with: settings, delegate: self)
        }
    }

    func switchCamera() {
        cameraPosition = cameraPosition == .back ? .front : .back
        sessionQueue.async {
            self.session.beginConfiguration()

            if let currentInput = self.currentInput {
                self.session.removeInput(currentInput)
            }

            do {
                let input = try self.makeInput(position: self.cameraPosition)
                if self.session.canAddInput(input) {
                    self.session.addInput(input)
                    self.currentInput = input
                }
            } catch {
                self.report(error.localizedDescription)
            }

            self.session.commitConfiguration()
        }
    }

    func clearError() {
        captureError = nil
    }

    func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    private func configureSessionIfNeeded() {
        sessionQueue.async {
            guard !self.isConfigured else {
                if !self.session.isRunning {
                    self.session.startRunning()
                }
                return
            }

            self.session.beginConfiguration()
            self.session.sessionPreset = .photo

            do {
                let input = try self.makeInput(position: self.cameraPosition)
                guard self.session.canAddInput(input) else {
                    throw CameraSetupError.inputUnavailable
                }
                self.session.addInput(input)
                self.currentInput = input

                guard self.session.canAddOutput(self.photoOutput) else {
                    throw CameraSetupError.outputUnavailable
                }
                self.session.addOutput(self.photoOutput)
            } catch {
                self.session.commitConfiguration()
                self.report(error.localizedDescription)
                return
            }

            self.session.commitConfiguration()
            self.isConfigured = true
            self.session.startRunning()
        }
    }

    private func makeInput(position: AVCaptureDevice.Position) throws -> AVCaptureDeviceInput {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) else {
            throw CameraSetupError.cameraUnavailable
        }
        return try AVCaptureDeviceInput(device: device)
    }

    private func report(_ message: String) {
        DispatchQueue.main.async {
            self.captureError = message
        }
    }
}

extension CameraController: AVCapturePhotoCaptureDelegate {
    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        if let error {
            report(error.localizedDescription)
            return
        }

        guard
            let data = photo.fileDataRepresentation(),
            let image = UIImage(data: data)
        else {
            report("Could not read captured photo.")
            return
        }

        DispatchQueue.main.async {
            self.lastPhoto = image
        }
    }
}

private enum CameraSetupError: LocalizedError {
    case cameraUnavailable
    case inputUnavailable
    case outputUnavailable

    var errorDescription: String? {
        switch self {
        case .cameraUnavailable:
            return "This device does not have a usable camera."
        case .inputUnavailable:
            return "DeepSpec could not connect to the camera input."
        case .outputUnavailable:
            return "DeepSpec could not prepare photo capture."
        }
    }
}
