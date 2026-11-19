import os
from gtts import gTTS

text = "Živjo Lina. Kakšno je vreme v Ljubljani in ali bo popoldne deževalo?"
tts = gTTS(text, lang='hr')
tts.save("test.mp3")

# Convert to 16kHz mono WAV
os.system("ffmpeg -y -i test.mp3 -ar 16000 -ac 1 orodja/test_sl.wav")
