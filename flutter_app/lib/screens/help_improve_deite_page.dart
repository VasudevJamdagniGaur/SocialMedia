import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../utils/hub_colors.dart';

const _whatsappNumber = '919536138120';

class HelpImproveDeitePage extends StatefulWidget {
  const HelpImproveDeitePage({super.key});

  @override
  State<HelpImproveDeitePage> createState() => _HelpImproveDeitePageState();
}

class _HelpImproveDeitePageState extends State<HelpImproveDeitePage> {
  String _objectiveId = 'feature';
  final _controller = TextEditingController();
  final _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _focusNode.requestFocus());
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  String get _objectiveLabel => _objectiveId == 'feature' ? 'Request Feature' : 'Report a Bug';

  bool get _canSend => _controller.text.trim().isNotEmpty;

  Future<void> _openWhatsApp() async {
    if (!_canSend) return;
    final body = 'Objective: $_objectiveLabel\n\nMessage:\n${_controller.text.trim()}';
    final uri = Uri.parse('https://wa.me/$_whatsappNumber?text=${Uri.encodeComponent(body)}');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: HubColors.bgSecondary,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 600),
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 8, 8, 16),
                  child: Row(
                    children: [
                      IconButton(
                        onPressed: () => context.pop(),
                        icon: const Icon(Icons.arrow_back, color: HubColors.textSecondary),
                      ),
                      const Expanded(
                        child: Text(
                          'Help improve ✨',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: HubColors.text, fontSize: 17, fontWeight: FontWeight.w600),
                        ),
                      ),
                      const SizedBox(width: 48),
                    ],
                  ),
                ),
                const Divider(height: 1, color: HubColors.divider),
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.all(20),
                    children: [
                      const Text('What are you sending?', style: TextStyle(color: HubColors.text, fontWeight: FontWeight.w500)),
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: const Color(0xFF1A1A1A),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(color: HubColors.divider),
                        ),
                        child: Row(
                          children: [
                            _tab('feature', 'Request feature'),
                            _tab('bug', 'Report a bug'),
                          ],
                        ),
                      ),
                      const SizedBox(height: 24),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Your message', style: TextStyle(color: HubColors.text, fontWeight: FontWeight.w500)),
                          Text('${_controller.text.length}', style: const TextStyle(color: HubColors.textSecondary, fontSize: 11)),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: const Color(0xFF1A1A1A),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: HubColors.divider),
                        ),
                        child: TextField(
                          controller: _controller,
                          focusNode: _focusNode,
                          maxLines: 8,
                          maxLength: 4000,
                          onChanged: (_) => setState(() {}),
                          style: const TextStyle(color: HubColors.text, fontSize: 15, height: 1.5),
                          decoration: const InputDecoration(
                            border: InputBorder.none,
                            counterText: '',
                            hintText: 'Describe your idea or issue…',
                            hintStyle: TextStyle(color: Colors.white54),
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        "We'll open WhatsApp with your text filled in — you can edit before sending.",
                        style: TextStyle(color: HubColors.textSecondary, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
                  decoration: const BoxDecoration(
                    border: Border(top: BorderSide(color: HubColors.divider)),
                    color: HubColors.bgSecondary,
                  ),
                  child: Column(
                    children: [
                      SizedBox(
                        width: double.infinity,
                        height: 50,
                        child: ElevatedButton(
                          onPressed: _canSend ? _openWhatsApp : null,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: _canSend ? HubColors.accent : HubColors.divider,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                            elevation: _canSend ? 8 : 0,
                          ),
                          child: const Text('Send on WhatsApp', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                        ),
                      ),
                      const SizedBox(height: 12),
                      const Text('We read every suggestion ❤️', style: TextStyle(color: HubColors.textSecondary, fontSize: 11)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _tab(String id, String label) {
    final active = _objectiveId == id;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _objectiveId = id),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: active ? HubColors.accent : Colors.transparent,
            borderRadius: BorderRadius.circular(999),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              color: active ? Colors.white : HubColors.textSecondary,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}
