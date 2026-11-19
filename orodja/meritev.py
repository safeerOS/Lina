import asyncio
from google import genai
from google.genai import types
import time
from pydub import AudioSegment
import sys
import os

async def meritev():
    print("Zacetek meritve (Vertex AI Gemini Live)")
    client = genai.Client(http_options={'api_version': 'v1beta1'}, vertexai=True, location="us-central1")
    
    audio_path = os.path.join(os.path.dirname(__file__), "..", "vprasanje.wav")
    if not os.path.exists(audio_path):
        audio_path = "vprasanje.wav"
        
    audio = AudioSegment.from_wav(audio_path)
    pcm_data = audio.raw_data
    
    rezultati = []
    
    for i in range(1, 4):
        print(f"\n--- Ponovitev {i} ---")
        try:
            # Povezava za vsako ponovitev (ali obdrzimo isto? Za cisto meritev odziva je bolje imeti novo, 
            # da ni vpliva prejsnjega konteksta, a za Live je morda ena sea)
            # Povežimo se na novo za res celotno meritev "klica"
            async with client.aio.live.connect(model="gemini-3.8-live") as session:
                start_time = time.time()
                await session.send_client_content(
                    turns={"role": "user", "parts": [{"inline_data": {"data": pcm_data, "mime_type": "audio/pcm;rate=16000"}}]},
                    turn_complete=True
                )
                sent_time = time.time()
                
                first_audio_time = None
                response_length = 0
                
                async for message in session.receive():
                    if hasattr(message, 'server_content') and message.server_content is not None:
                        model_turn = message.server_content.model_turn
                        if model_turn:
                            for part in model_turn.parts:
                                if part.inline_data and "audio" in part.inline_data.mime_type:
                                    if first_audio_time is None:
                                        first_audio_time = time.time()
                                    response_length += len(part.inline_data.data)
                    
                    if hasattr(message, 'server_content') and message.server_content and message.server_content.turn_complete:
                        break
                
                end_time = time.time()
                
                if first_audio_time is None:
                    print("Napaka: ni bilo zvocnega odgovora")
                    continue
                
                do_prvega = (first_audio_time - start_time) * 1000
                skupno = (end_time - start_time) * 1000
                
                print(f"Cas do prvega zvocnega paketa: {do_prvega:.2f} ms")
                print(f"Skupno trajanje odgovora: {skupno:.2f} ms")
                print(f"Dolzina odgovora: {response_length} bajtov")
                
                rezultati.append({
                    "do_prvega": do_prvega,
                    "skupno": skupno,
                    "dolzina": response_length
                })
                
        except Exception as e:
            print(f"Napaka pri povezavi: {e!r}")
            
    print("\n--- Povzetek ---")
    for idx, r in enumerate(rezultati):
        print(f"Ponovitev {idx+1}: prvi paket = {r['do_prvega']:.0f} ms, skupno = {r['skupno']:.0f} ms, dolzina = {r['dolzina']} B")

if __name__ == "__main__":
    asyncio.run(meritev())
