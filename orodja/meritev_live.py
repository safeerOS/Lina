import asyncio
import json
import base64
import time
import os
import sys

try:
    import websockets
except ImportError:
    print("Potrebna je knjiznica websockets (pip install websockets)")
    sys.exit(1)

def dobi_sistemsko_navodilo():
    pot = "openline/android/samostojna/src/main/kotlin/si/safeer/lina/samostojna/SistemskoNavodilo.kt"
    try:
        with open(pot, "r", encoding="utf-8") as f:
            for vrstica in f:
                if "Si Lina, osebna asistentka" in vrstica:
                    return "Si Lina, osebna asistentka z umetno inteligenco v uporabnikovem telefonu. Delas samostojno, racunalnika ne potrebujes. Odgovarjaj kratko in jasno, v jeziku, v katerem te uporabnik nagovori (privzeto slovensko; o sebi govori v zenski obliki). Ne izmisljuj dejstev: ce nekaj ne veš, to povej."
    except Exception:
        pass
    return "Si Lina, osebna asistentka z umetno inteligenco v uporabnikovem telefonu. Odgovarjaj kratko in jasno."

async def izmeri(st_ponovitev=3):
    api_key = os.environ.get("GEMINI_API_KEY")
    
    if api_key:
        print("Uporabljam Gemini API (GEMINI_API_KEY).")
        url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.BidiService/BidiGenerateContent?key={api_key}"
        model = "models/gemini-2.0-flash-exp"
        headers = {}
    else:
        print("GEMINI_API_KEY ni nastavljen. Uporabljam Vertex AI prek ADC.")
        try:
            import google.auth
            from google.auth.transport.requests import Request
        except ImportError:
            print("Potrebna je knjiznica google-auth (pip install google-auth)")
            sys.exit(1)
        
        credentials, project = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
        credentials.refresh(Request())
        token = credentials.token
        location = "us-central1"
        url = f"wss://{location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent"
        model = f"projects/{project}/locations/{location}/publishers/google/models/gemini-2.0-flash-exp"
        headers = {"Authorization": f"Bearer {token}"}
        
    sistemsko_navodilo = dobi_sistemsko_navodilo()
    
    with open("orodja/test_sl.wav", "rb") as f:
        f.read(44) # Preskoci WAV glavo
        audio_data = f.read()
        
    rezultati = []
        
    for i in range(st_ponovitev):
        print(f"\n--- Ponovitev {i+1} ---")
        try:
            async with websockets.connect(url, additional_headers=headers) as ws:
                setup_msg = {
                    "setup": {
                        "model": model,
                        "systemInstruction": {
                            "parts": [{"text": sistemsko_navodilo}]
                        },
                        "generationConfig": {
                            "responseModalities": ["AUDIO"]
                        }
                    }
                }
                await ws.send(json.dumps(setup_msg))
                resp = await ws.recv()
                
                chunk = {
                    "clientContent": {
                        "turns": [{
                            "role": "user",
                            "parts": [{
                                "inlineData": {
                                    "mimeType": "audio/pcm;rate=16000",
                                    "data": base64.b64encode(audio_data).decode('utf-8')
                                }
                            }]
                        }],
                        "turnComplete": True
                    }
                }
                start_t = time.time()
                await ws.send(json.dumps(chunk))
                
                first_audio_t = None
                total_audio_len = 0
                
                while True:
                    try:
                        resp = await asyncio.wait_for(ws.recv(), timeout=15.0)
                        data = json.loads(resp)
                        if "serverContent" in data:
                            content = data["serverContent"]
                            if "modelTurn" in content:
                                for part in content["modelTurn"].get("parts", []):
                                    if "inlineData" in part:
                                        if first_audio_t is None:
                                            first_audio_t = time.time() - start_t
                                            print(f"Prvi zvok: {first_audio_t*1000:.0f} ms")
                                        audio_bytes = base64.b64decode(part["inlineData"]["data"])
                                        total_audio_len += len(audio_bytes)
                            if content.get("turnComplete"):
                                total_t = time.time() - start_t
                                print(f"Konec odgovora. Skupni cas: {total_t*1000:.0f} ms, velikost zvoka: {total_audio_len} B")
                                rezultati.append((first_audio_t*1000, total_t*1000, total_audio_len))
                                break
                        elif "error" in data:
                            print("Napaka API-ja:", data["error"])
                            break
                    except asyncio.TimeoutError:
                        print("Casovna omejitev (timeout) pri cakanju na odgovor.")
                        break
                        
        except Exception as e:
            print("Napaka pri povezavi ali izvajanju:", e)
            
    print("\n--- Povzetek ---")
    for idx, (first, total, size) in enumerate(rezultati):
        print(f"{idx+1}. Prvi zvok: {first:.0f} ms, Skupaj: {total:.0f} ms, Zvok: {size} B")

if __name__ == "__main__":
    asyncio.run(izmeri())
