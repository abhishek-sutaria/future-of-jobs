#!/usr/bin/env python3
"""
Score Tasks with Gemini Script
==============================
Scans src/data.ts for job tasks, scores them using Google Gemini API
(AI Capability vs Human Criticality), and updates data.ts in-place.

Usage: python3 scripts/score_tasks_gemini.py
"""

import os
import re
import json
import time
import os
import re
import json
import time
import urllib.request
import urllib.error

# Configuration
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_TS_PATH = os.path.join(PROJECT_ROOT, "src", "data.ts")
CACHE_PATH = os.path.join(PROJECT_ROOT, "data", "ai_task_scores_cache.json")
ENV_PATH = os.path.join(PROJECT_ROOT, ".env")

# API Configuration
API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"

def get_api_key():
    """Read API key from .env file"""
    api_key = os.environ.get("VITE_GEMINI_API_KEY")
    if not api_key and os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r") as f:
            for line in f:
                if line.startswith("VITE_GEMINI_API_KEY="):
                    api_key = line.strip().split("=", 1)[1]
                    break
    
    if not api_key:
        # Try checking if it's exported in shell
        api_key = os.environ.get("GEMINI_API_KEY")

    if not api_key:
        print("❌ Error: VITE_GEMINI_API_KEY not found in .env or environment")
        exit(1)
    return api_key

def load_cache():
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, "r") as f:
            return json.load(f)
    return {}

def save_cache(cache):
    with open(CACHE_PATH, "w") as f:
        json.dump(cache, f, indent=2)

def score_task(task_text, api_key):
    """Call Gemini API to score a task"""
    print(f"   🤖 Scoring: {task_text[:60]}...")
    
    prompt = f"""
    You are an expert in labor economics and AI capabilities. 
    Analyze the following job task and provide two scores between 0.0 and 1.0:
    
    Task: "{task_text}"
    
    1. ai_exposure: How feasible is it for GenAI/LLMs to automate this task individually? (0.0 = impossible, 1.0 = fully automatable today)
    2. human_criticality: How essential is human judgment, empathy, or physical presence? (0.0 = not essential, 1.0 = absolutely critical)
    
    Return ONLY valid JSON in this format:
    {{ "ai_exposure": 0.5, "human_criticality": 0.5 }}
    """
    
    data = {
        "contents": [{
            "parts": [{"text": prompt}]
        }]
    }
    
    json_data = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(f"{API_URL}?key={api_key}", data=json_data, headers={"Content-Type": "application/json"})
    
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode("utf-8"))
        
        # Parse text response
        text = result["candidates"][0]["content"]["parts"][0]["text"]
        # Extract JSON from text (in case of markdown blocks)
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            json_str = match.group(0)
            scores = json.loads(json_str)
            return scores
        else:
            print(f"      ⚠️ Could not parse JSON from response: {text[:50]}...")
            return None
            
    except urllib.error.HTTPError as e:
        print(f"      ❌ API Error: {e.code} {e.reason}")
        print(f"      Response: {e.read().decode('utf-8')[:200]}")
        return None
    except Exception as e:
        print(f"      ❌ Error: {e}")
        return None

def main():
    print("=" * 60)
    print("Gemini Task Scoring Pipeline")
    print("=" * 60)
    
    api_key = get_api_key()
    print(f"🔑 API Key found: {api_key[:4]}...{api_key[-4:]}")
    
    cache = load_cache()
    print(f"📂 Loaded {len(cache)} cached task scores")
    
    # Read data.ts
    with open(DATA_TS_PATH, "r") as f:
        content = f.read()
    
    # Find all task objects
    # Pattern looks for:
    # {
    #    "name": "...",
    #    "aiCapabilityScore": ...,
    #    "humanCriticalityScore": ...,
    #    "importance": ...
    # }
    # We'll use a regex that captures the whole object to replace it, 
    # but specifically targeting the name and scores.
    
    # Actually, simpler approach: match just the specific lines for each task
    # We iterate through the file, keep track of valid tasks.
    
    # Let's find all unique task names first
    task_names = re.findall(r'"name":\s*"([^"]+)"', content)
    unique_tasks = list(set(task_names))
    print(f"📝 Found {len(unique_tasks)} unique tasks in data.ts")
    
    updates = 0
    api_calls = 0
    
    for task_name in unique_tasks:
        if task_name in cache:
            continue
            
        # Rate limit
        if api_calls > 0:
            time.sleep(1.0) 
            
        scores = score_task(task_name, api_key)
        if scores:
            cache[task_name] = scores
            updates += 1
            api_calls += 1
            
            # Save incrementally
            if updates % 5 == 0:
                save_cache(cache)
                print(f"      💾 Cache saved ({len(cache)} total)")
    
    if updates > 0:
        save_cache(cache)
        print("💾 Final cache save")
    
    print("\n🔄 Updating data.ts with scores...")
    
    # Replace scores in content
    # We scan line by line or block by block. 
    # Since regex replacement on the whole file can be tricky with duplicate task names (if any),
    # but unique task names map to unique scores in our logic.
    
    # We need to preserve the structure.
    # Pattern: 
    # "name": "Task Name",
    # "aiCapabilityScore": 0.5,
    # "humanCriticalityScore": 0.5,
    
    # We will iterate through each cached task and run a replacement on the content.
    # Be careful with escaping regex special characters in task names.
    
    new_content = content
    replaced_count = 0
    
    for task_name, scores in cache.items():
        # Escape task name for regex
        escaped_name = re.escape(task_name)
        
        # Regex to find the task block
        # Look for name followed by optional whitespace/newlines, then matches for ai/human scores
        # We replace the score lines.
        
        # Construct specific replacement values
        ai_score = scores.get("ai_exposure", 0.5)
        human_score = scores.get("human_criticality", 0.5)
        
        # Replacement pattern:
        # Search for: "name": "Exact Task Name", (anything until) "aiCapabilityScore": (number), (anything until) "humanCriticalityScore": (number)
        # This is hard because they might be on different lines or orders.
        # But data.ts formatting seems consistent.
        
        # Let's try to locate the specific task block index
        # This approach is safer:
        # Find all occurrences of the task name
        pattern = r'("name":\s*"' + escaped_name + r'",\s*\n\s*"aiCapabilityScore":\s*)([\d\.]+)(,\s*\n\s*"humanCriticalityScore":\s*)([\d\.]+)'
        
        def replacement_func(match):
            return f'{match.group(1)}{ai_score}{match.group(3)}{human_score}'
            
        new_content, n = re.subn(pattern, replacement_func, new_content)
        if n > 0:
            replaced_count += n
            # print(f"   Updated: {task_name[:30]}... -> AI:{ai_score}, Human:{human_score}")
        else:
             # Try alternative formatting if the first regex failed (e.g. different key order or spacing)
             # But assuming Prettier-like formatting from previous edits
             pass

    with open(DATA_TS_PATH, "w") as f:
        f.write(new_content)
        
    print(f"✅ Updated {replaced_count} task occurrences in data.ts")
    print("Done!")

if __name__ == "__main__":
    main()
