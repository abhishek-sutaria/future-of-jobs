import os
import base64

# Configuration
OUTPUT_HTML = "Future_of_Jobs_Report.html"
DIAGRAMS_DIR = "report_assets"

# Ensure diagrams exist (reuse logic or expect them to be there)
# For simplicity, we assume they are there from the PDF step. 
# If not, we could import the generation functions, but let's just check.

def get_image_base64(path):
    if os.path.exists(path):
        with open(path, "rb") as img_file:
            return base64.b64encode(img_file.read()).decode('utf-8')
    return ""

def generate_html_report():
    # Load Diagram Images as Base64 to make the HTML self-contained
    flow1_path = os.path.join(DIAGRAMS_DIR, 'system_flow.png')
    flow2_path = os.path.join(DIAGRAMS_DIR, 'data_pipeline.png')
    
    img1_b64 = get_image_base64(flow1_path)
    img2_b64 = get_image_base64(flow2_path)

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Future of Jobs - Project Status Report</title>
    <style>
        :root {{
            --primary: #1a237e;
            --secondary: #303f9f;
            --accent: #e8eaf6;
            --text: #333;
            --bg: #f5f5f7;
        }}
        body {{
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: var(--text);
            background: var(--bg);
            margin: 0;
            padding: 0;
        }}
        .container {{
            max-width: 900px;
            margin: 0 auto;
            background: white;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            min-height: 100vh;
        }}
        header {{
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: white;
            padding: 4rem 2rem;
            text-align: center;
        }}
        h1 {{ margin: 0; font-size: 2.5rem; letter-spacing: -1px; }}
        .subtitle {{ opacity: 0.8; font-size: 1.2rem; margin-top: 0.5rem; }}
        .meta {{ margin-top: 2rem; font-size: 0.9rem; opacity: 0.7; }}
        
        nav {{
            background: #fff;
            position: sticky;
            top: 0;
            border-bottom: 1px solid #eee;
            padding: 1rem 2rem;
            z-index: 100;
            display: flex;
            justify-content: center;
            gap: 2rem;
        }}
        nav a {{
            text-decoration: none;
            color: var(--secondary);
            font-weight: 600;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            transition: color 0.2s;
        }}
        nav a:hover {{ color: var(--primary); text-decoration: underline; }}
        
        section {{
            padding: 3rem 2rem;
            border-bottom: 1px solid #eee;
        }}
        h2 {{
            color: var(--primary);
            font-size: 1.8rem;
            margin-bottom: 1.5rem;
            border-left: 5px solid var(--secondary);
            padding-left: 1rem;
        }}
        
        /* Interactive Table */
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 1.5rem 0;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }}
        th {{
            background: var(--primary);
            color: white;
            padding: 1rem;
            text-align: left;
        }}
        td {{
            padding: 1rem;
            border-bottom: 1px solid #eee;
        }}
        tr:last-child td {{ border-bottom: none; }}
        tr:hover {{ background-color: var(--accent); }}
        
        /* Flowchart Images */
        .diagram-container {{
            text-align: center;
            margin: 2rem 0;
            padding: 1rem;
            background: var(--bg);
            border-radius: 8px;
            border: 1px solid #ddd;
        }}
        img {{
            max-width: 100%;
            height: auto;
            border-radius: 4px;
        }}
        
        .roadmap-list {{
            list-style: none;
            padding: 0;
        }}
        .roadmap-item {{
            background: var(--accent);
            margin-bottom: 1rem;
            padding: 1.5rem;
            border-radius: 8px;
            border-left: 4px solid var(--secondary);
            transition: transform 0.2s;
        }}
        .roadmap-item:hover {{
            transform: translateX(5px);
            background: #e3e5f1;
        }}
        .roadmap-title {{ font-weight: bold; color: var(--primary); display: block; margin-bottom: 0.5rem; }}
        
        footer {{
            text-align: center;
            padding: 2rem;
            color: #666;
            font-size: 0.8rem;
            background: var(--bg);
        }}
    </style>
</head>
<body>

<div class="container">
    <header>
        <h1>Future of Jobs</h1>
        <div class="subtitle">Project Status Report</div>
        <div class="meta">
            Date: February 18, 2026 &bull; Version: 0.9.0 (Beta Lead)
        </div>
    </header>

    <nav>
        <a href="#optimizations">Optimizations</a>
        <a href="#architecture">Architecture</a>
        <a href="#pipeline">Data Pipeline</a>
        <a href="#roadmap">Roadmap</a>
    </nav>

    <section id="optimizations">
        <h2>System Optimizations</h2>
        <p>We have executed a targeted optimization strategy focusing on three core pillars: Data, Architecture, and Performance.</p>
        
        <table>
            <thead>
                <tr>
                    <th>Area</th>
                    <th>Optimization Implemented</th>
                    <th>High-Impact Result</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Data Pipeline</td>
                    <td>Switched from static placeholders to BLS OES 2023 integration.</td>
                    <td><strong>100% Real-World Statistics</strong></td>
                </tr>
                <tr>
                    <td>Architecture</td>
                    <td>Decoupled 'God Component' into modular React units.</td>
                    <td>Improved Maintainability</td>
                </tr>
                <tr>
                    <td>Performance</td>
                    <td>Implemented LOD (Level of Detail) & Shader Uniforms.</td>
                    <td>Stable 60fps Rendering</td>
                </tr>
                <tr>
                    <td>Features</td>
                    <td>Added PDF Resume Analysis (pdfjs-dist).</td>
                    <td>Secure, Client-Side Processing</td>
                </tr>
            </tbody>
        </table>
    </section>

    <section id="architecture">
        <h2>System Logic Flow</h2>
        <p>The system architecture facilitates a seamless flow of data from the User Interaction layer through the global State Store to the 3D Visualization engine.</p>
        
        <div class="diagram-container">
            <img src="data:image/png;base64,{img1_b64}" alt="System Architecture Flowchart">
            <p><i>Figure 1: High-Level System Architecture</i></p>
        </div>
    </section>

    <section id="pipeline">
        <h2>Data Pipeline & Reliability</h2>
        <p>A robust Extraction, Transform, and Load (ETL) pipeline was constructed to ingest official government data from the BLS.</p>
        
        <div class="diagram-container">
            <img src="data:image/png;base64,{img2_b64}" alt="Data Pipeline Flowchart">
            <p><i>Figure 2: Data Ingestion Pipeline</i></p>
        </div>
    </section>

    <section id="roadmap">
        <h2>Strategic Roadmap</h2>
        <p>To achieve 'World-Class' production status, the following features are prioritized for the next sprint.</p>
        
        <ul class="roadmap-list">
            <li class="roadmap-item">
                <span class="roadmap-title">Comparison Mode</span>
                Side-by-side role analysis for decision support.
            </li>
            <li class="roadmap-item">
                <span class="roadmap-title">Social Enablement</span>
                Deep-linking URLs for viral sharing of insights.
            </li>
            <li class="roadmap-item">
                <span class="roadmap-title">Production Hardening</span>
                Migration to serverless backend for secure API proxying.
            </li>
        </ul>
    </section>

    <footer>
        Generated by Antigravity AI Engineering &bull; Confidential
    </footer>
</div>

</body>
</html>"""

    with open(OUTPUT_HTML, "w") as f:
        f.write(html_content)
    
    print(f"HTML Report generated: {OUTPUT_HTML}")

if __name__ == "__main__":
    generate_html_report()
