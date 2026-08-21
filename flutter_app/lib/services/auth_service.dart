import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

/// Mirrors src/services/authService.js

class AuthResult {
  final bool success;
  final String? error;
  final String? message;
  final bool? isNewUser;
  final Map<String, dynamic>? user;

  AuthResult({
    required this.success,
    this.error,
    this.message,
    this.isNewUser,
    this.user,
  });
}

class AuthService {
  AuthService._();
  static final AuthService instance = AuthService._();
  factory AuthService() => instance;

  final FirebaseAuth _auth = FirebaseAuth.instance;

  /// Web OAuth client from google-services.json (client_type 3).
  /// Required on Android so Google returns an ID token for Firebase Auth.
  static const String _webClientId =
      '300613626896-afgue1cj09n7mibt6b84t0qgjkc0avqk.apps.googleusercontent.com';

  final GoogleSignIn _googleSignIn = GoogleSignIn(
    scopes: const ['email', 'profile'],
    serverClientId: _webClientId,
  );

  User? getCurrentUser() => _auth.currentUser;

  Stream<User?> onAuthStateChange() => _auth.authStateChanges();

  Future<AuthResult> signInWithGoogle() async {
    try {
      if (kIsWeb) {
        return AuthResult(
          success: false,
          error: 'Google Sign-In is only available in the native app. Please open the Android app.',
        );
      }

      final googleUser = await _googleSignIn.signIn().timeout(
        const Duration(seconds: 60),
        onTimeout: () => throw Exception('Google sign-in timed out. Please try again.'),
      );

      if (googleUser == null) {
        return AuthResult(success: false, error: 'Sign-in was cancelled.');
      }

      final googleAuth = await googleUser.authentication;
      final idToken = googleAuth.idToken;
      if (idToken == null) {
        throw Exception('Google sign-in did not return an ID token. Please try again.');
      }

      final credential = GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: idToken,
      );
      final userCredential = await _auth.signInWithCredential(credential);
      final user = userCredential.user;

      return AuthResult(
        success: true,
        isNewUser: userCredential.additionalUserInfo?.isNewUser ?? false,
        user: user != null
            ? {
                'uid': user.uid,
                'email': user.email,
                'displayName': user.displayName,
                'photoURL': user.photoURL,
              }
            : null,
      );
    } on FirebaseAuthException catch (e) {
      return _handleGoogleError(e);
    } catch (e) {
      final msg = e.toString();
      if (RegExp(r'cancel|cancelled|user_cancel', caseSensitive: false).hasMatch(msg)) {
        return AuthResult(success: false, error: 'Sign-in was cancelled.');
      }
      if (RegExp(r'timeout|timed out', caseSensitive: false).hasMatch(msg)) {
        return AuthResult(success: false, error: 'Google sign-in timed out. Please try again.');
      }
      if (RegExp(r'10|12500|developer error|sign_in_failed|DEVELOPER_ERROR', caseSensitive: false)
          .hasMatch(msg)) {
        debugPrint('[Auth] Google Sign-In DEVELOPER_ERROR/code 10: $msg');
        return AuthResult(
          success: false,
          error:
              'Google Sign-In is misconfigured (code 10). '
              'If this app was installed from Play Store, add the Play App Signing SHA-1 '
              'in Firebase Console → Project settings → Your apps → therapist.deite.app, '
              'then download a fresh google-services.json and ship a new build. '
              'See GOOGLE_SIGNIN_SHA.md in the repo.',
        );
      }
      return AuthResult(success: false, error: msg.isNotEmpty ? msg : 'Google sign-in failed. Please try again.');
    }
  }

  AuthResult _handleGoogleError(FirebaseAuthException e) {
    final code = e.code;
    if (code == '12501') {
      return AuthResult(success: false, error: 'Sign-in was cancelled.');
    }
    return AuthResult(success: false, error: e.message ?? 'Google sign-in failed.');
  }

  Future<AuthResult> signUpUser(String email, String password, String? displayName) async {
    try {
      final userCredential = await _auth.createUserWithEmailAndPassword(
        email: email,
        password: password,
      );
      final user = userCredential.user;
      if (user != null && displayName != null && displayName.isNotEmpty) {
        await user.updateDisplayName(displayName);
      }
      return AuthResult(
        success: true,
        user: {
          'uid': user?.uid,
          'email': user?.email,
          'displayName': user?.displayName ?? displayName,
        },
      );
    } on FirebaseAuthException catch (e) {
      return AuthResult(success: false, error: e.message);
    }
  }

  Future<Map<String, dynamic>> checkEmailExists(String email) async {
    try {
      final methods = await _auth.fetchSignInMethodsForEmail(email);
      return {'exists': methods.isNotEmpty, 'methods': methods};
    } catch (e) {
      return {'exists': false, 'error': '$e'};
    }
  }

  Future<AuthResult> signInUser(String email, String password) async {
    try {
      final userCredential = await _auth.signInWithEmailAndPassword(
        email: email,
        password: password,
      );
      final user = userCredential.user;
      return AuthResult(
        success: true,
        user: {
          'uid': user?.uid,
          'email': user?.email,
          'displayName': user?.displayName,
        },
      );
    } on FirebaseAuthException catch (e) {
      return AuthResult(success: false, error: e.message, user: {'errorCode': e.code});
    }
  }

  Future<AuthResult> sendPasswordReset(String email) async {
    try {
      await _auth.sendPasswordResetEmail(email: email);
      return AuthResult(
        success: true,
        message: 'Password reset email sent! Please check your inbox.',
      );
    } on FirebaseAuthException catch (e) {
      String errorMessage = 'Failed to send password reset email. Please try again.';
      if (e.code == 'user-not-found') {
        errorMessage = 'No account found with this email address.';
      } else if (e.code == 'invalid-email') {
        errorMessage = 'Invalid email address.';
      } else if (e.code == 'too-many-requests') {
        errorMessage = 'Too many requests. Please try again later.';
      }
      return AuthResult(success: false, error: errorMessage);
    }
  }

  Future<AuthResult> signOutUser() async {
    try {
      await _googleSignIn.signOut();
      await _auth.signOut();
      return AuthResult(success: true);
    } catch (e) {
      return AuthResult(success: false, error: '$e');
    }
  }
}
