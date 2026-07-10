# -*- coding: utf-8 -*-
from fpdf import FPDF

BG    = (13, 15, 20)
BRAND = (255, 90, 31)
DARK  = (24, 28, 38)
GRAY  = (110, 120, 138)
LIGHT = (235, 239, 245)
TXT   = (30, 34, 42)

class PDF(FPDF):
    def header(self):
        # Brand header band
        self.set_fill_color(*BG)
        self.rect(0, 0, 210, 34, "F")
        # JZ mark box
        self.set_fill_color(*BRAND)
        self.rect(14, 9, 16, 16, "F")
        self.set_xy(14, 9)
        self.set_font("Helvetica", "B", 13)
        self.set_text_color(255, 255, 255)
        self.cell(16, 16, "JZ", align="C")
        # Title
        self.set_xy(34, 9)
        self.set_font("Helvetica", "B", 16)
        self.set_text_color(255, 255, 255)
        self.cell(0, 8, "JZac Designs", ln=1)
        self.set_xy(34, 17)
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(255, 90, 31)
        self.cell(0, 6, "V I N Y L   Q U O T E   T O O L", ln=1)
        self.ln(22)

    def footer(self):
        self.set_y(-16)
        self.set_draw_color(*BRAND)
        self.set_line_width(0.5)
        self.line(14, self.get_y(), 196, self.get_y())
        self.set_y(-13)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*GRAY)
        self.cell(0, 6, "JZac Designs  -  JZacDesigns@proton.me", align="C")

pdf = PDF()
pdf.set_auto_page_break(True, margin=20)
pdf.add_page()
pdf.set_left_margin(14)
pdf.set_right_margin(14)

# Intro title
pdf.set_font("Helvetica", "B", 18)
pdf.set_text_color(*TXT)
pdf.cell(0, 10, "How to Add the Quote Tool to Your iPhone", ln=1)
pdf.ln(1)
pdf.set_font("Helvetica", "", 11)
pdf.set_text_color(*GRAY)
pdf.multi_cell(0, 6,
    "This is our custom vinyl quoting app. It works completely offline once it's on your phone - "
    "no internet needed. Follow these steps to install it as a home-screen app.")
pdf.ln(5)

def step(num, title, body):
    y = pdf.get_y()
    # number circle
    pdf.set_fill_color(*BRAND)
    pdf.ellipse(14, y, 8, 8, "F")
    pdf.set_xy(14, y)
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(8, 8, str(num), align="C")
    # title
    pdf.set_xy(27, y)
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(*TXT)
    pdf.cell(0, 8, title, ln=1)
    # body
    pdf.set_x(27)
    pdf.set_font("Helvetica", "", 10.5)
    pdf.set_text_color(70, 76, 88)
    pdf.multi_cell(165, 5.5, body)
    pdf.ln(4)

step(1, "Open the file I sent you",
     "Open the email or text message and tap the file named  JZac-Quote-Tool.html.")
step(2, "Open it in Safari",
     "If you see a code preview or it won't open normally, tap the Share icon (the box with an "
     "up-arrow) and choose 'Open in Safari'. If you don't see that, tap 'More' then Safari. "
     "(It MUST be open in Safari for the next step to work.)")
step(3, "Tap the Share icon",
     "Once the app is showing in Safari, tap the Share icon at the bottom of the screen "
     "(the square with the up-arrow).")
step(4, "Add to Home Screen",
     "Scroll down the menu and tap 'Add to Home Screen', then tap 'Add' in the top corner.")
step(5, "You're done",
     "A 'JZac Quotes' icon is now on your home screen. Tap it anytime - it opens full-screen "
     "and works with no internet connection.")

pdf.ln(2)
# Tip box
y = pdf.get_y()
pdf.set_fill_color(255, 244, 238)
pdf.set_draw_color(*BRAND)
pdf.set_line_width(0.4)
pdf.rect(14, y, 182, 26, "DF")
pdf.set_xy(18, y + 3)
pdf.set_font("Helvetica", "B", 10)
pdf.set_text_color(*BRAND)
pdf.cell(0, 5, "Good to know", ln=1)
pdf.set_x(18)
pdf.set_font("Helvetica", "", 9.5)
pdf.set_text_color(70, 76, 88)
pdf.multi_cell(174, 5,
    "- Once installed, it saves your quotes right on the phone and works fully offline.\n"
    "- To send a finished quote to a customer, open it and tap 'Export PDF' to save or share it.")

pdf.output("E:/JZacs Lead Machine/JZac-Quote-Tool-Instructions.pdf")
print("PDF created")
