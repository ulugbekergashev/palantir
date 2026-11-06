/**
 * Mikrofon. Brauzer uni faqat himoyalangan sahifada beradi (https yoki shu kompyuterning o'zi): qabulxonadagi boshqa kompyuter panelni
 * http://192.168.1.10:3200 bilan ochganda (server/lan.ts) navigator.mediaDevices umuman yo'q — «ruxsat berilmadi» emas, aniq sabab aytiladi.
 */
export const MIC_UNAVAILABLE = 'MicUnavailable';

export function micStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    const e = new Error("Bu kompyuterda mikrofon ishlamaydi: brauzer uni faqat server kompyuterining o'zida yoki Hub havolasida (https) beradi");
    e.name = MIC_UNAVAILABLE;
    return Promise.reject(e);
  }
  return navigator.mediaDevices.getUserMedia(constraints);
}
