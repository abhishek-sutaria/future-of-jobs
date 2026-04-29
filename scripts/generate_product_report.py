import os
import base64
import graphviz

# Configuration
OUTPUT_HTML = "Future_of_Jobs_Product_Launch.html"
DIAGRAMS_DIR = "report_assets"

if not os.path.exists(DIAGRAMS_DIR):
    os.makedirs(DIAGRAMS_DIR)

def get_image_base64(path):
    if os.path.exists(path):
        with open(path, "rb") as img_file:
            return base64.b64encode(img_file.read()).decode('utf-8')
    return ""

def create_user_journey_flowchart():
    # A friendly user journey flow
    dot = graphviz.Digraph('User Journey', comment='User Experience', format='png')
    dot.attr(rankdir='LR', dpi='300', nodesep='0.5', ranksep='0.5')
    
    # Node Styles: Friendly, rounded, colorful
    dot.attr('node', shape='box', style='rounded,filled', 
             fontname='Arial', fontsize='12', 
             color='white', penwidth='0')
    
    dot.node('Start', '1. Drag & Drop\nYour Resume', fillcolor='#4FC3F7', fontcolor='white')
    dot.node('AI', '2. AI Analyzes\nYour Skills', fillcolor='#BA68C8', fontcolor='white')
    dot.node('Match', '3. See "Safe Zones"\nvs "Risk Areas"', fillcolor='#FF8A65', fontcolor='white')
    dot.node('Plan', '4. Get Personal\nUpskilling Plan', fillcolor='#81C784', fontcolor='white')
    
    dot.edge('Start', 'AI', color='#B0BEC5', penwidth='2')
    dot.edge('AI', 'Match', color='#B0BEC5', penwidth='2')
    dot.edge('Match', 'Plan', color='#B0BEC5', penwidth='2')
    
    output_path = os.path.join(DIAGRAMS_DIR, 'user_journey')
    dot.render(output_path, cleanup=True)
    return output_path + '.png'

def create_data_source_flowchart():
    # Visualizing the "Truth" upgrade
    dot = graphviz.Digraph('Data Source', comment='Data Truth', format='png')
    dot.attr(rankdir='TB', dpi='300')
    dot.attr('node', shape='ellipse', style='filled', fontname='Arial', fontsize='11', color='white')
    
    dot.node('Old', 'Old Version:\n"Fake Numbers"', fillcolor='#EF9A9A', fontcolor='white')
    dot.node('New', 'New Version:\nVerified Government Data', fillcolor='#66BB6A', fontcolor='white', fontsize='14', shape='box', style='rounded,filled')
    
    dot.edge('Old', 'New', label=' REPLACED WITH ', color='#EF5350', fontcolor='#EF5350', style='dashed')
    
    # Sub-nodes for the "New" truth
    dot.node('BLS', 'US Bureau of Labor Statistics\n(413,000 Real Data Points)', fillcolor='#E8F5E9', fontcolor='#2E7D32', shape='note')
    dot.node('Google', 'Google Gemini AI\n(Live Intelligence)', fillcolor='#E8F5E9', fontcolor='#2E7D32', shape='note')
    
    dot.edge('New', 'BLS', color='#66BB6A')
    dot.edge('New', 'Google', color='#66BB6A')
    
    output_path = os.path.join(DIAGRAMS_DIR, 'data_truth')
    dot.render(output_path, cleanup=True)
    return output_path + '.png'

def generate_product_report():
    print("Generating visuals...")
    journey_path = create_user_journey_flowchart()
    data_metrics_path = create_data_source_flowchart()
    
    # Get Screenshot path (Assuming the one we used before exists)
    # If not, we fall back to a placeholder or omit
    screenshot_path = "/Users/abhishek/.gemini/antigravity/brain/75f1dab7-90e1-4822-8738-f79592f41cf2/.system_generated/click_feedback/click_feedback_1771440134741.png"
    
    img_journey_b64 = get_image_base64(journey_path)
    img_data_b64 = get_image_base64(data_metrics_path)
    img_screen_b64 = get_image_base64(screenshot_path)

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Future of Jobs 2.0 - Launch Report</title>
    <style>
        :root {{
            --brand-color: #00E5FF; /* Cyan */
            --dark-bg: #0F172A;
            --card-bg: #1E293B;
            --text-main: #F1F5F9;
            --text-muted: #94A3B8;
        }}
        body {{
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: var(--text-main);
            background: var(--dark-bg);
            margin: 0;
            padding: 0;
        }}
        .container {{
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
        }}
        
        /* Hero Section */
        header {{
            text-align: center;
            padding: 4rem 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            animation: fadeIn 1s ease-out;
        }}
        h1 {{
            font-size: 3rem;
            margin: 0;
            background: linear-gradient(to right, #fff, var(--brand-color));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -1px;
        }}
        .tagline {{
            font-size: 1.25rem;
            color: var(--text-muted);
            margin-top: 1rem;
        }}
        
        /* Screenshot Card */
        .hero-image {{
            margin-top: 2rem;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 20px 50px rgba(0,0,0,0.5);
            border: 1px solid rgba(255,255,255,0.1);
        }}
        .hero-image img {{ width: 100%; display: block; }}
        
        /* Features Section */
        section {{
            margin: 4rem 0;
        }}
        h2 {{
            font-size: 2rem;
            color: white;
            border-left: 4px solid var(--brand-color);
            padding-left: 1rem;
            margin-bottom: 2rem;
        }}
        
        .feature-grid {{
            display: grid;
            grid-template-columns: 1fr;
            gap: 2rem;
        }}
        @media (min-width: 600px) {{
            .feature-grid {{ grid-template-columns: 1fr 1fr; }}
        }}
        
        .feature-card {{
            background: var(--card-bg);
            padding: 2rem;
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.05);
            transition: transform 0.2s;
        }}
        .feature-card:hover {{
            transform: translateY(-5px);
            border-color: var(--brand-color);
        }}
        .icon {{ font-size: 2rem; margin-bottom: 1rem; display: block; }}
        .feature-title {{ font-size: 1.25rem; font-weight: bold; margin-bottom: 0.5rem; color: white; }}
        .feature-desc {{ color: var(--text-muted); font-size: 0.95rem; }}
        
        /* Visuals */
        .visual-container {{
            background: white;
            padding: 2rem;
            border-radius: 12px;
            text-align: center;
            margin: 2rem 0;
        }}
        .visual-container img {{ max-width: 100%; }}
        .caption {{ color: #666; font-size: 0.85rem; margin-top: 1rem; display: block; }}
        
        /* Quote */
        .highlight-box {{
            background: linear-gradient(135deg, rgba(0,229,255,0.1), rgba(0,0,0,0));
            border: 1px solid rgba(0,229,255,0.2);
            padding: 2rem;
            border-radius: 12px;
            text-align: center;
            font-size: 1.2rem;
            font-style: italic;
            color: #fff;
        }}

        @keyframes fadeIn {{
            from {{ opacity: 0; transform: translateY(20px); }}
            to {{ opacity: 1; transform: translateY(0); }}
        }}
    </style>
</head>
<body>

<div class="container">
    <header>
        <h1>Future of Jobs 2.0</h1>
        <div class="tagline">From "Static Prototype" to <strong>Intelligent Career Platform</strong></div>
        
        <div class="hero-image">
            <img src="data:image/png;base64,{img_screen_b64}" alt="Application Dashboard">
        </div>
    </header>

    <div class="highlight-box">
        "We didn't just fix bugs. We connected the application to the real world."
    </div>

    <section>
        <h2>What's New?</h2>
        <div class="feature-grid">
            <div class="feature-card">
                <span class="icon">📊</span>
                <div class="feature-title">Real Government Data</div>
                <div class="feature-desc">
                    We removed all the fake "placeholder" numbers. The app now pulls 400,000+ data points directly from the <strong>US Bureau of Labor Statistics</strong>.
                </div>
            </div>
            
            <div class="feature-card">
                <span class="icon">🧠</span>
                <div class="feature-title">AI Resume Analysis</div>
                <div class="feature-desc">
                    <strong>Drag & Drop your actual PDF resume.</strong> The AI doesn't just scan for keywords; it understands your career path and predicts your "Survival Score" for 2030.
                </div>
            </div>
            

        </div>
    </section>

    <section>
        <h2>The User Experience</h2>
        <p style="color: var(--text-muted); margin-bottom: 2rem;">
            We simplified the complex logic into a simple 4-step journey for the user:
        </p>
        
        <div class="visual-container">
            <img src="data:image/png;base64,{img_journey_b64}" alt="User Journey Flowchart">
            <span class="caption">New simplified user flow</span>
        </div>
    </section>

    <section>
        <h2>From Fiction to Fact</h2>
        <p style="color: var(--text-muted); margin-bottom: 2rem;">
            The biggest improvement is <strong>Trust</strong>. Here is how we upgraded the data foundation:
        </p>
        
        <div class="visual-container">
            <img src="data:image/png;base64,{img_data_b64}" alt="Data Source Upgrade">
            <span class="caption">Data Architecture Transformation</span>
        </div>
    </section>

    <footer style="text-align: center; color: var(--text-muted); opacity: 0.6; margin-top: 4rem;">
        Generated by Antigravity Engineering • February 2026
    </footer>
</div>

</body>
</html>"""

    with open(OUTPUT_HTML, "w") as f:
        f.write(html_content)
    
    print(f"Product Launch Report generated: {OUTPUT_HTML}")

if __name__ == "__main__":
    generate_product_report()
