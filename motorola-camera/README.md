# MotoCam

Câmera simples (foto e vídeo) que **sempre abre em modo vídeo**. Feita para uso
com suporte de peito: o atalho do botão liga/desliga do Motorola abre direto
na gravação.

## Instalar

1. Baixe o APK em *Actions → MotoCam APK → motocam-debug-apk* no GitHub (ou
   compile com `gradle assembleDebug` no Android Studio).
2. Instale no celular (permita "instalar apps desconhecidos").
3. Abra o app uma vez e permita câmera e microfone.
4. Em *Configurações → Apps*, **desative o app de câmera padrão** do Motorola.
   O atalho passa a abrir o MotoCam.

## Detalhes

- Registra os intents `STILL_IMAGE_CAMERA`, `STILL_IMAGE_CAMERA_SECURE` e
  `VIDEO_CAMERA`; qualquer um deles abre em modo vídeo.
- Vídeo em Full HD (com fallback) salvo em `Movies/MotoCam`; fotos em
  `Pictures/MotoCam`.
- Para começar a gravar sozinho ao abrir, mude `AUTO_START_RECORDING` para
  `true` em `MainActivity.kt`.
- Botão de volume (+ ou -) inicia e para a gravação (ou tira foto, no modo foto).
- Android 10+ (minSdk 29).
