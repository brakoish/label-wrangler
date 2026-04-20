import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { zpl, width, height, dpi } = await request.json();

    if (!zpl || !width || !height) {
      return NextResponse.json({ error: 'Missing required fields: zpl, width, height' }, { status: 400 });
    }

    // Convert DPI to Labelary format: 6dpmm=152, 8dpmm=203, 12dpmm=300, 24dpmm=600
    let dpmm = '8dpmm'; // Default 203 DPI
    if (dpi === 300) dpmm = '12dpmm';
    else if (dpi === 152) dpmm = '6dpmm';
    else if (dpi === 600) dpmm = '24dpmm';

    const url = `https://api.labelary.com/v1/printers/${dpmm}/labels/${width}x${height}/0/`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'image/png',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: zpl,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Labelary API error: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const imageBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(imageBuffer).toString('base64');

    return NextResponse.json({
      image: `data:image/png;base64,${base64}`,
      width,
      height,
      dpi,
    });
  } catch (error) {
    console.error('ZPL preview error:', error);
    return NextResponse.json(
      { error: 'Failed to generate ZPL preview' },
      { status: 500 }
    );
  }
}
